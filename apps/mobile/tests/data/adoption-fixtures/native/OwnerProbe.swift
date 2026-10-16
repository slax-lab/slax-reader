import Darwin
import Foundation

@main struct OwnerProbe {
  static func main() throws {
    #if targetEnvironment(simulator)
    let arguments = CommandLine.arguments
    guard arguments.count == 3 else { throw CocoaError(.fileReadInvalidFileName) }
    let device = arguments[1], path = arguments[2]
    let uuid = "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
    guard device.range(of: "^\(uuid)$", options: .regularExpression) != nil,
          path.range(of: "^.*/CoreSimulator/Devices/\(device)/data/Containers/Shared/AppGroup/\(uuid)/\\.slax-data-owner\\.lock$", options: .regularExpression) != nil,
          URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path else { throw CocoaError(.fileReadInvalidFileName) }
    let group = URL(fileURLWithPath: path).deletingLastPathComponent()
    let metadata = try Data(contentsOf: group.appendingPathComponent(".com.apple.mobile_container_manager.metadata.plist"))
    guard let values = try PropertyListSerialization.propertyList(from: metadata, format: nil) as? [String: Any],
          values["MCMMetadataIdentifier"] as? String == "group.app.slax.reader" else { throw CocoaError(.fileReadCorruptFile) }
    // Do not create a file: the controlled app must already have acquired its production lease.
    let descriptor = open(path, O_RDWR)
    guard descriptor >= 0 else { throw CocoaError(.fileReadNoSuchFile) }
    defer { close(descriptor) }
    let acquired = flock(descriptor, LOCK_EX | LOCK_NB) == 0
    let failure = acquired ? 0 : errno
    guard acquired || failure == EWOULDBLOCK || failure == EAGAIN else { throw CocoaError(.fileLocking) }
    if acquired { flock(descriptor, LOCK_UN) }
    print("{\"kind\":\"slax-native-owner-probe\",\"platform\":\"ios-simulator\",\"acquired\":\(acquired),\"errno\":\(failure)}")
    #else
    throw CocoaError(.featureUnsupported)
    #endif
  }
}
