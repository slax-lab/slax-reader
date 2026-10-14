import UIKit

final class SourceShareHostController: UIViewController {
    private let state: String
    init(state: String) {self.state = state; super.init(nibName: nil, bundle: nil)}
    required init?(coder: NSCoder) {fatalError("Only a declared synthetic state is supported")}
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        let label = UILabel(); label.text = "Original source Share UI: \(state)"; label.textAlignment = .center
        let button = UIButton(type: .system)
        button.setTitle("Share original fixture", for: .normal)
        button.accessibilityIdentifier = "source-share-present"
        button.addTarget(self, action: #selector(presentShare), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [label, button]); stack.axis = .vertical; stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: view.centerXAnchor), stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
    }
    @objc private func presentShare() {
        let activity = UIActivityViewController(activityItems: [URL(string: "https://source-share.test/\(state)")!], applicationActivities: nil)
        activity.popoverPresentationController?.sourceView = view
        present(activity, animated: true)
    }
}

@main final class SourceShareHost: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        precondition(Bundle.main.bundleIdentifier == "app.slax.reader.sourcesharefixture")
        let arguments = ProcessInfo.processInfo.arguments
        let index = arguments.firstIndex(of: "--fixture-share-state")
        let state = index.flatMap {arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil} ?? "loading"
        precondition(["loading", "success", "error"].contains(state))
        let window = UIWindow(frame: UIScreen.main.bounds); window.overrideUserInterfaceStyle = .light
        window.rootViewController = SourceShareHostController(state: state); window.makeKeyAndVisible(); self.window = window
        return true
    }
}
