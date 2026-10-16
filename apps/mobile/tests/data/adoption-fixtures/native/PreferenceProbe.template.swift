import Foundation
import Darwin

// Only directory resolution and the Expo callback wrapper are replaced.
// Lock, decoder and CAS bodies are copied verbatim at build time.
final class ProductionPreferences {
  private static let preferencesMutex = NSLock()
  private let root: URL
  init(_ root: URL) {self.root = root}
  private func sharedDirectory() throws -> URL {root}
@@LOCKING_AND_SNAPSHOT@@
  func read() throws -> [String: Any] {try withPreferencesLock {root, _ in try readSnapshot(root)}}
  func compareAndSwap(revision: Int, values: [String: Any]) throws -> Bool {
@@COMPARE_AND_SWAP@@
  }
  func hold(_ operation: () throws -> Void) throws {try withPreferencesLock {_, _ in try operation()}}
}

@main struct PreferenceProbe {
  static func check(_ value: Bool) throws {if !value {throw CocoaError(.fileReadCorruptFile)}}
  static func read(_ file: URL) throws -> [String: Any] {
    let attributes = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    try check(attributes.isRegularFile == true && attributes.isSymbolicLink != true)
    guard let value = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any] else {throw CocoaError(.fileReadCorruptFile)}
    return value
  }
  static func publish(_ file: URL, _ value: [String: Any]) throws {
    if FileManager.default.fileExists(atPath: file.path) {try check(try file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true)}
    try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: file, options: [.atomic])
  }
  static func main() throws {
    let args = CommandLine.arguments
    try check(args.count == 4 && args[1].range(of: "^[0-9A-Fa-f-]{36}$", options: .regularExpression) != nil)
    let device = args[1], support = URL(fileURLWithPath: args[2]), root = URL(fileURLWithPath: args[3])
    try check(support.resolvingSymlinksInPath() == support && root.resolvingSymlinksInPath() == root)
    try check(support.path.contains("/CoreSimulator/Devices/\(device)/data/Containers/Data/Application/") && support.path.hasSuffix("/Library/Application Support") && root.path.contains("/CoreSimulator/Devices/\(device)/data/Containers/Shared/AppGroup/"))
    let metadata = try PropertyListSerialization.propertyList(from: Data(contentsOf: root.appendingPathComponent(".com.apple.mobile_container_manager.metadata.plist")), format: nil) as? [String: Any]
    try check(metadata?["MCMMetadataIdentifier"] as? String == "group.app.slax.reader")
    let source = try read(support.appendingPathComponent("legacy-fixture-report.json"))
    try check(source["controlledFixture"] as? Bool == true && source["fixtureVersion"] as? Int == 1 && source["iosBundleId"] as? String == "app.slax.reader" && source["producer"] as? String == "powersync-kotlin-1.14.1")
    let service = try read(support.appendingPathComponent("native-service-report.json"))
    try check(service["status"] as? String == "passed" && service["platform"] as? String == "ios" && service["originalLegacyFirstQueueUpload"] as? Bool == true && service["coreVersion"] as? String == "0.5.3/2ba6b280")
    let request = try read(support.appendingPathComponent("native-preference-cas-request.json"))
    try check(request["kind"] as? String == "slax-native-preference-cas-request" && request["version"] as? Int == 1 && request["device"] as? String == device && request["platform"] as? String == "ios" && request["serviceRunId"] as? String == service["runId"] as? String && request["sourceSHA256"] as? String == "@@SOURCE_SHA256@@")
    guard let nonce = request["nonce"] as? String, let requestedAt = request["requestedAt"] as? NSNumber else {throw CocoaError(.fileReadCorruptFile)}
    try check(nonce.range(of: "^[0-9a-f-]{36}$", options: .regularExpression) != nil)
    let state = try read(support.appendingPathComponent("native-preference-cas-state.json"))
    try check(state["kind"] as? String == "slax-native-preference-cas-state" && state["nonce"] as? String == nonce && state["phase"] as? String == "waiting-probe" && (state["requestedAt"] as? NSNumber) == requestedAt)
    let target = support.appendingPathComponent("native-preference-cas-probe.json"), store = ProductionPreferences(root)
    var event: [String: Any] = ["kind": "slax-native-preference-cas-probe", "version": 1, "nonce": nonce, "requestedAt": requestedAt, "platform": "ios", "pid": getpid(), "sourceSHA256": "@@SOURCE_SHA256@@"]
    switch request["mode"] as? String {
    case "stale-cas":
      let before = try store.read()
      guard let revision = before["revision"] as? Int, var values = before["values"] as? [String: Any] else {throw CocoaError(.fileReadCorruptFile)}
      try check(revision == state["revision"] as? Int)
      values["native_cas_probe"] = nonce
      let applied = try store.compareAndSwap(revision: revision, values: values)
      try check(applied)
      let after = try store.read()
      try check(after["revision"] as? Int == revision + 1)
      event.merge(["phase": "committed", "revisionBefore": revision, "revisionAfter": revision + 1, "applied": applied]) {_, value in value}
      try publish(target, event)
    case "lock-read":
      try store.hold {
        event.merge(["phase": "lock-held", "heldAt": Date().timeIntervalSince1970 * 1000]) {_, value in value}
        try publish(target, event)
        Thread.sleep(forTimeInterval: 8)
      }
      event.merge(["phase": "lock-released", "releasedAt": Date().timeIntervalSince1970 * 1000]) {_, value in value}
      try publish(target, event)
    default: throw CocoaError(.fileReadCorruptFile)
    }
    let result: [String: Any] = ["kind": "slax-native-preference-cas-probe-result", "nonce": nonce, "status": "passed"]
    print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
  }
}
