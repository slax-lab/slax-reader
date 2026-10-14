import Foundation
import SlaxLegacyFixture
import UIKit

@main
@MainActor
final class LegacyFixtureApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private let producer = LegacyFixtureProducer()

    static func main() {
        UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(LegacyFixtureApp.self))
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let controller = UIViewController()
        controller.view.backgroundColor = .systemBackground
        let label = UILabel()
        label.numberOfLines = 0
        label.text = "Creating controlled Kotlin 1.14.1 offline fixture…"
        label.frame = CGRect(x: 24, y: 80, width: 340, height: 320)
        controller.view.addSubview(label)
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        do {
            guard Bundle.main.bundleIdentifier == "app.slax.reader",
                  ProcessInfo.processInfo.environment["SIMULATOR_UDID"] != nil,
                  let shared = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.slax.reader") else {
                throw FixtureFailure.message("A controlled simulator App Group is required")
            }
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).resolvingSymlinksInPath()
            let database = support.appendingPathComponent("databases/powersync.db").resolvingSymlinksInPath()
            guard !FileManager.default.fileExists(atPath: database.path),
                  !FileManager.default.fileExists(atPath: shared.appendingPathComponent("user.preferences_pb").path) else {
                throw FixtureFailure.message("Existing data must never be overwritten")
            }
            producer.createFixture(sharedDirectory: shared.path, cacheDirectory: support.path) {report, error in
                DispatchQueue.main.async {
                    do {
                        if error != nil { throw FixtureFailure.message("The original Kotlin producer failed") }
                        guard let report,
                              var json = try JSONSerialization.jsonObject(with: Data(report.utf8)) as? [String: Any],
                              FileManager.default.fileExists(atPath: database.path),
                              FileManager.default.fileExists(atPath: shared.appendingPathComponent("user.preferences_pb").path) else {
                            throw FixtureFailure.message("The original native files are missing")
                        }
                        json["databasePath"] = database.path
                        json["dataDirectory"] = support.path
                        json["nativePlatform"] = "ios-simulator"
                        let bytes = try JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys])
                        // Kotlin returned only after its old database owner closed successfully.
                        try bytes.write(to: support.appendingPathComponent("legacy-fixture-report.json"), options: .atomic)
                        label.text = "Created Kotlin 1.14.1 offline fixture: 2 pending transactions / 4 operations"
                    } catch {
                        label.text = "FAILED: \(error.localizedDescription)"
                    }
                }
            }
        } catch {
            label.text = "FAILED: \(error.localizedDescription)"
        }
        return true
    }
}

private enum FixtureFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
