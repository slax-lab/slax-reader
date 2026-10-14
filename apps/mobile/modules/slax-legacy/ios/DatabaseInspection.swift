import CryptoKit
import Foundation
import SQLite3

private struct SnapshotDigest {
  private var state = SHA256()
  mutating func add(_ value: String?) {
    guard let value else { state.update(data: Data("-:".utf8)); return }
    let bytes = Data(value.utf8)
    state.update(data: Data("\(bytes.count):".utf8)); state.update(data: bytes)
  }
  func finish() -> String { state.finalize().map { String(format: "%02x", $0) }.joined() }
}

/** Read-only inspection preserves the original database and its pending WAL. */
func inspectPowerSyncDatabase(_ path: String, cancellation: DatabaseInspectionCancellation = DatabaseInspectionCancellation()) throws -> [String: Any] {
  var database: OpaquePointer?
  guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK, let database else {
    if let database { sqlite3_close(database) }
    throw CocoaError(.fileReadCorruptFile)
  }
  defer { cancellation.close(database) }
  try cancellation.attach(database)
  sqlite3_busy_timeout(database, 250)
  func query(_ sql: String, row: ([String?]) throws -> Void) throws {
    try cancellation.check()
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw CocoaError(.fileReadCorruptFile) }
    defer { sqlite3_finalize(statement) }
    while true {
      try cancellation.check()
      let result = sqlite3_step(statement)
      if result == SQLITE_DONE { return }
      guard result == SQLITE_ROW else { throw CocoaError(.fileReadCorruptFile) }
      let values: [String?] = (0..<sqlite3_column_count(statement)).map { column in
        guard sqlite3_column_type(statement, column) != SQLITE_NULL, let value = sqlite3_column_text(statement, column) else { return nil }
        return String(cString: value)
      }
      try row(values)
    }
  }
  var integrityRows: [String?] = []; try query("PRAGMA quick_check") { integrityRows.append($0[0]) }
  var formatVersion = 0; try query("SELECT ifnull(max(id),0) FROM ps_migration") { formatVersion = Int($0[0] ?? "") ?? -1 }
  var userVersion = 0; try query("PRAGMA user_version") { userVersion = Int($0[0] ?? "") ?? -1 }
  var tables: [String] = []
  try query("SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'ps_data__*' OR name GLOB 'ps_data_local__*') ORDER BY name") {
    guard let table = $0[0] else { throw CocoaError(.fileReadCorruptFile) }; tables.append(table)
  }
  var queue = SnapshotDigest(), operationCount = 0, transactionCount = 0, previousTransaction: String?
  try query("SELECT id,tx_id,data FROM ps_crud ORDER BY id") { values in
    if operationCount == 0 || values[1] != previousTransaction { transactionCount += 1 }
    previousTransaction = values[1]; operationCount += 1
    values.forEach { queue.add($0) }
    guard let json = values[2], let entry = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
      let id = entry["id"] as? String, !id.isEmpty, let table = entry["type"] as? String, !table.isEmpty,
      let operation = entry["op"] as? String, ["PUT", "PATCH", "DELETE"].contains(operation) else { throw CocoaError(.fileReadCorruptFile) }
  }
  var data = SnapshotDigest(), local = SnapshotDigest()
  for table in tables {
    let isLocal = table.hasPrefix("ps_data_local__")
    data.add(table); if isLocal { local.add(table) }
    let quoted = table.replacingOccurrences(of: "\"", with: "\"\"")
    try query("SELECT id,data FROM \"\(quoted)\" ORDER BY id COLLATE BINARY") { values in
      guard let json = values[1], try JSONSerialization.jsonObject(with: Data(json.utf8)) is [String: Any] else { throw CocoaError(.fileReadCorruptFile) }
      values.forEach { data.add($0) }; if isLocal { values.forEach { local.add($0) } }
    }
  }
  return ["databasePath": path, "integrityValid": integrityRows == ["ok"], "formatVersion": formatVersion, "userVersion": userVersion,
    "storageTables": tables, "pendingOperations": operationCount, "pendingTransactions": transactionCount,
    "queueDigest": queue.finish(), "dataDigest": data.finish(), "localDigest": local.finish()]
}
