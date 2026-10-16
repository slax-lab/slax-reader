import Foundation

@main struct IdentityMain {
  static func main() {
    let prefix = "/Users/test/Library/Developer/CoreSimulator/Devices/32D9AFE0-32C7-443A-8FEC-3EBB42135386/data/Containers/Data/Application/"
    let old = prefix + "E89DAAA5-06C8-4B8F-81E0-C8BBAF43944F/Library/Application Support"
    let current = prefix + "DA94D7FD-B7BB-404B-AE3D-FE0528BBE6F1/Library/Application Support"
    let slot = "/databases/powersync.db"
    let group = URL(fileURLWithPath: "/Users/test/Library/Developer/CoreSimulator/Devices/32D9AFE0-32C7-443A-8FEC-3EBB42135386/data/Containers/Shared/AppGroup/controlled-group")
    let original = legacyDatabaseIdentities([old + slot], support: URL(fileURLWithPath: old), shared: group, bundleIdentifier: "app.slax.reader")[old + slot]!
    let updated = legacyDatabaseIdentities([current + slot], support: URL(fileURLWithPath: current), shared: group, bundleIdentifier: "app.slax.reader")[current + slot]!
    precondition(original == updated)
    precondition(updated["relativePath"] == "Library/Application Support/databases/powersync.db")
    precondition(updated["relocationPrefix"] == prefix)
    let otherApp = legacyDatabaseIdentities([current + slot], support: URL(fileURLWithPath: current), shared: group, bundleIdentifier: "other.app")[current + slot]!
    precondition(otherApp["owner"] != updated["owner"])
    let otherGroup = legacyDatabaseIdentities([current + slot], support: URL(fileURLWithPath: current), shared: group.appendingPathComponent("different-group"), bundleIdentifier: "app.slax.reader")[current + slot]!
    precondition(otherGroup["owner"] != updated["owner"])
    let invalid = ["/outside/powersync.db", current + "/databases/../databases/powersync.db"]
    precondition(legacyDatabaseIdentities(invalid, support: URL(fileURLWithPath: current), shared: group, bundleIdentifier: "app.slax.reader").isEmpty)
    precondition(legacyDatabaseIdentities(["/controlled/powersync.db"], support: URL(fileURLWithPath: "/controlled"), shared: group, bundleIdentifier: "app.slax.reader").isEmpty)
    print("{\"status\":\"passed\",\"scope\":\"production Swift identity helper, host execution\",\"sameContainerUpdate\":true,\"otherOwnerRejected\":true,\"noncanonicalCandidateRejected\":true}")
  }
}
