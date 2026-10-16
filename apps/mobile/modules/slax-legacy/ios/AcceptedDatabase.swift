import Foundation
import SQLite3

func inspectAcceptedPowerSyncDatabase(_ path: String, cancellation: DatabaseInspectionCancellation = DatabaseInspectionCancellation()) throws -> [String: Any] {
  var handle: OpaquePointer?
  guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK, let database = handle else {
    if let handle { sqlite3_close(handle) }
    throw CocoaError(.fileReadCorruptFile)
  }
  defer { cancellation.close(database) }
  try cancellation.attach(database)
  sqlite3_busy_timeout(database, 250)
  func values(_ sql: String) throws -> [String] {
    try cancellation.check()
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw CocoaError(.fileReadCorruptFile) }
    defer { sqlite3_finalize(statement) }
    var result: [String] = []
    while true {
      let status = sqlite3_step(statement)
      if status == SQLITE_DONE { return result }
      guard status == SQLITE_ROW, let text = sqlite3_column_text(statement, 0) else { throw CocoaError(.fileReadCorruptFile) }
      result.append(String(cString: text))
    }
  }
  return ["databasePath": path,
    "formatVersion": Int(try values("SELECT ifnull(max(id),0) FROM ps_migration").first ?? "") ?? -1,
    "userVersion": Int(try values("PRAGMA user_version").first ?? "") ?? -1,
    "storageTables": try values("SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'ps_data__*' OR name GLOB 'ps_data_local__*') ORDER BY name")]
}

func acceptedDatabaseCandidate(values: [String: Any], support: URL, shared: URL, bundleIdentifier: String, cancellation: DatabaseInspectionCancellation = DatabaseInspectionCancellation()) -> String? {
  guard let encoded = values["_slax_database_adoption_v1"] as? String,
        let data = encoded.data(using: .utf8),
        let journal = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        journal["phase"] as? String == "accepted",
        journal["targetSdk"] as? String == "powersync-react-native-2.3.1",
        journal["profile"] as? String == "slax-powersync-format14-schema2-v1",
        journal["schemaVersion"] as? String == "2",
        let path = journal["path"] as? String,
        let identity = journal["logicalIdentity"] as? [String: String] else { return nil }
  let canonical = support.appendingPathComponent("databases/powersync.db").path
  guard path == canonical, FileManager.default.fileExists(atPath: canonical),
        URL(fileURLWithPath: canonical).resolvingSymlinksInPath().path == canonical,
        legacyDatabaseIdentities([canonical], support: support, shared: shared, bundleIdentifier: bundleIdentifier)[canonical] == identity,
        let before = journal["before"] as? [String: Any], before["databasePath"] as? String == canonical,
        before["formatVersion"] as? Int == 14, before["userVersion"] as? Int == 1,
        let tables = before["storageTables"] as? [String],
        let current = try? inspectAcceptedPowerSyncDatabase(canonical, cancellation: cancellation),
        current["formatVersion"] as? Int == 14, current["userVersion"] as? Int == 1,
        (current["storageTables"] as? [String])?.sorted() == tables.sorted() else { return nil }
  return canonical
}
