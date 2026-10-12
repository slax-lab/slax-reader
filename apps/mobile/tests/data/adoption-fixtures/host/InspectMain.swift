import Foundation
@main struct InspectMain {
  static func main() throws {
    let result = try inspectPowerSyncDatabase(CommandLine.arguments[1])
    print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
  }
}
