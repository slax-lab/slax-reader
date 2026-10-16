import UIKit

/// An empty, separate UI-test host with no App Group or database access.
@main final class UpgradeVisibleHost: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        precondition(Bundle.main.bundleIdentifier == "app.slax.reader.upgradefixturehost")
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = UIViewController()
        window.rootViewController?.view.backgroundColor = .white
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
