import Foundation
import SQLite3
import UIKit

@main struct Host {
  static func main() throws {
    let first = StorageOwner(), second = StorageOwner()
    try first.acquire()
    do { try second.acquire(); preconditionFailure("Competing owner accepted") } catch {}
    second.release()
    do { try first.acquire(); preconditionFailure("Reentrant owner accepted") } catch {}
    first.release(); try second.acquire(); second.release()

    let application = UIApplication.shared
    let completed = try StorageActivity(name: "completed")
    precondition(application.active.count == 1)
    completed.finish(); completed.finish()
    precondition(application.active.isEmpty && application.ended == 1)
    var cancelled = false
    let expired = try StorageActivity(name: "expired", cancel: { cancelled = true })
    application.expire()
    precondition(cancelled)
    do {try expired.check(); preconditionFailure("Expired assertion accepted work")} catch {}
    expired.finish()
    precondition(application.active.isEmpty && application.ended == 2)
    let bounded = try StorageActivity(name: "deadline", seconds: 0.01)
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    do {try bounded.check(); preconditionFailure("Deadline accepted work")} catch {}
    precondition(application.active.isEmpty)
    application.allowed = false
    do {_ = try StorageActivity(name: "denied"); preconditionFailure("Denied assertion accepted work")} catch {}
    application.allowed = true
    let transition = StorageTransition(), old = try transition.begin(), new = try transition.begin()
    transition.finish(old)
    precondition(application.active.count == 1)
    do {try transition.check(old); preconditionFailure("Finished token accepted")} catch {}
    try transition.check(new)
    application.expire()
    do {try transition.check(new); preconditionFailure("Expired token accepted")} catch {}
    transition.finish(old); transition.finish(new)
    precondition(application.active.isEmpty)
    transition.observe(); transition.observe()
    NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
    precondition(application.active.count == 1)
    transition.stopObserving()
    precondition(application.active.isEmpty)
    NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
    precondition(application.active.isEmpty)

    func background() {
      application.applicationState = .inactive
      NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
      application.applicationState = .background
      NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
    }
    func foreground() {
      application.applicationState = .active
      NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    foreground()
    let longForeground = try StorageActivity(name: "long foreground")
    let longToken = try transition.begin()
    RunLoop.main.run(until: Date().addingTimeInterval(5.1))
    try longForeground.check(); try transition.check(longToken)
    precondition(application.active.isEmpty)
    background()
    precondition(application.active.count == 2)
    foreground()
    precondition(application.active.isEmpty)
    try longForeground.check(); try transition.check(longToken)
    longForeground.finish(); transition.finish(longToken)

    var backgroundCancelled = false
    let backgroundBound = try StorageActivity(name: "background bound", seconds: 0.02, cancel: { backgroundCancelled = true })
    background()
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    precondition(backgroundCancelled && application.active.isEmpty)
    foreground()
    do {try backgroundBound.check(); preconditionFailure("Foreground revived expired work")} catch {}

    let rapid = try StorageActivity(name: "rapid lifecycle", seconds: 0.05)
    let rapidToken = try transition.begin()
    background()
    let obsoleteExpirations = Array(application.active.values)
    foreground()
    obsoleteExpirations.forEach { $0() }
    RunLoop.main.run(until: Date().addingTimeInterval(5.1))
    try rapid.check(); try transition.check(rapidToken)
    precondition(application.active.isEmpty)
    background()
    precondition(application.active.count == 2)
    RunLoop.main.run(until: Date().addingTimeInterval(5.1))
    precondition(application.active.isEmpty)
    foreground()
    do {try rapid.check(); preconditionFailure("Rapid lifecycle revived expired work")} catch {}
    do {try transition.check(rapidToken); preconditionFailure("Foreground revived expired token")} catch {}
    transition.finish(rapidToken)

    let root = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    let containers = root.appendingPathComponent("CoreSimulator/Devices/522DD84F-0407-4707-BBAB-0263B4ACE2DA/data/Containers")
    let support = containers.appendingPathComponent("Data/Application/9F3CD522-89CD-4B8E-9074-F592D18ADCC3/Library/Application Support")
    let shared = containers.appendingPathComponent("Shared/AppGroup/CA892185-0726-4753-9AD1-B47FF2383CA5")
    let file = support.appendingPathComponent("databases/powersync.db")
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    var database: OpaquePointer?
    precondition(sqlite3_open(file.path, &database) == SQLITE_OK)
    precondition(sqlite3_exec(database, "CREATE TABLE ps_migration(id INTEGER); INSERT INTO ps_migration VALUES(14); PRAGMA user_version=1; CREATE TABLE ps_data__sr_user(id TEXT, data TEXT);", nil, nil, nil) == SQLITE_OK)
    sqlite3_close(database)
    let schema = try inspectAcceptedPowerSyncDatabase(file.path)
    precondition(schema["formatVersion"] as? Int == 14 && schema["userVersion"] as? Int == 1)
    precondition(schema["storageTables"] as? [String] == ["ps_data__sr_user"])
    let identity = legacyDatabaseIdentities([file.path], support: support, shared: shared, bundleIdentifier: "app.slax.reader")[file.path]!
    var journal: [String: Any] = ["path": file.path, "phase": "accepted", "targetSdk": "powersync-react-native-2.3.1", "profile": "slax-powersync-format14-schema2-v1", "schemaVersion": "2", "logicalIdentity": identity, "before": schema]
    func candidate() throws -> String? {
      let encoded = String(data: try JSONSerialization.data(withJSONObject: journal), encoding: .utf8)!
      return acceptedDatabaseCandidate(values: ["_slax_database_adoption_v1": encoded], support: support, shared: shared, bundleIdentifier: "app.slax.reader")
    }
    let accepted = try candidate(); precondition(accepted == file.path)
    for field in ["phase", "targetSdk", "profile", "schemaVersion", "path"] {
      let saved = journal[field]; journal[field] = "wrong"
      let rejected = try candidate(); precondition(rejected == nil); journal[field] = saved
    }
    journal["logicalIdentity"] = ["owner": "other"]
    let rejected = try candidate(); precondition(rejected == nil)
    var longQuery: OpaquePointer?
    precondition(sqlite3_open(":memory:", &longQuery) == SQLITE_OK)
    let cancellation = DatabaseInspectionCancellation()
    try cancellation.attach(longQuery!)
    DispatchQueue.global().asyncAfter(deadline: .now() + 0.02) { cancellation.cancel() }
    let started = Date()
    let result = sqlite3_exec(longQuery, "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n", nil, nil, nil)
    precondition(result == SQLITE_INTERRUPT && Date().timeIntervalSince(started) < 1)
    cancellation.detach()
    precondition(sqlite3_close(longQuery) == SQLITE_OK)
    let denied = DatabaseInspectionCancellation(); denied.cancel()
    do { try inspectPowerSyncDatabase(file.path, cancellation: denied); preconditionFailure("Cancelled inspection accepted") } catch {}
    precondition(sqlite3_open(file.path, &database) == SQLITE_OK)
    precondition(sqlite3_exec(database, "CREATE TABLE ps_crud(id INTEGER, tx_id INTEGER, data TEXT); INSERT INTO ps_crud VALUES(1,1,'{\"id\":\"one\",\"type\":\"sr_user\",\"op\":\"PUT\"}');", nil, nil, nil) == SQLITE_OK)
    sqlite3_close(database)
    let verified = try inspectPowerSyncDatabase(file.path)
    precondition(verified["pendingOperations"] as? Int == 1 && verified["pendingTransactions"] as? Int == 1)
    print("production Swift lifecycle and accepted-schema helpers passed; UIKit assertion boundary is synthetic")
  }
}
