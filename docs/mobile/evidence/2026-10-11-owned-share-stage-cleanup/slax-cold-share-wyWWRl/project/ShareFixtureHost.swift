import UIKit

/// A standalone synthetic URL sender. It is never linked into the application.
@main final class ShareFixtureHost: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        precondition(Bundle.main.bundleIdentifier == "app.slax.reader.sharefixturehost")
        #if !targetEnvironment(simulator)
        preconditionFailure("The share fixture must run on its owned simulator")
        #endif
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = ShareSender()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

@MainActor private final class ShareSender: UIViewController {
    private var scenario = ""
    private var origin = ""
    private var runId = ""
    private var simulator = ""
    private let status = UILabel()
    private let share = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        let arguments = ProcessInfo.processInfo.arguments
        func argument(_ name: String) -> String {
            guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { preconditionFailure("Missing controlled share argument") }
            return arguments[index + 1]
        }
        scenario = argument("--scenario")
        origin = argument("--api-origin")
        runId = argument("--fixture-run-id")
        simulator = argument("--fixture-device")
        let allowed = ["success", "legacy-success", "signed-out", "expired", "rejected", "failed", "cancel"]
        precondition(allowed.contains(scenario))
        guard let components = URLComponents(string: origin), components.scheme == "http", components.host == "127.0.0.1", let port = components.port, port > 1024, components.path.isEmpty, components.query == nil, components.fragment == nil, components.user == nil, components.password == nil else { preconditionFailure("Use only the owned loopback controller") }
        status.text = "Preparing controlled share"
        status.accessibilityIdentifier = "share-fixture-status"
        share.setTitle("Share controlled URL", for: .normal)
        share.accessibilityIdentifier = "share-fixture-send"
        share.isEnabled = false
        share.addTarget(self, action: #selector(send), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [status, share])
        stack.axis = .vertical; stack.spacing = 24; stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: view.centerXAnchor), stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
        Task {
            do {
                try prepareSyntheticPreferences()
                var request = URLRequest(url: URL(string: origin + "/fixture/control")!)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: ["scenario": scenario])
                let (_, response) = try await URLSession.shared.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw CocoaError(.fileReadUnknown) }
                status.text = "Ready: " + scenario
                share.isEnabled = true
            } catch { status.text = "Controlled setup failed" }
        }
    }

    private func prepareSyntheticPreferences() throws {
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.slax.reader") else { throw CocoaError(.fileReadNoPermission) }
        let ownerURL = root.appendingPathComponent("slax-share-fixture-owner.json")
        let properties = try ownerURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard properties.isRegularFile == true, properties.isSymbolicLink != true else { throw CocoaError(.fileReadNoPermission) }
        guard let owner = try JSONSerialization.jsonObject(with: Data(contentsOf: ownerURL)) as? [String: Any], owner["kind"] as? String == "slax-controlled-cold-share", owner["version"] as? Int == 1, owner["runId"] as? String == runId, owner["device"] as? String == simulator, root.path.contains("/CoreSimulator/Devices/" + simulator + "/data/Containers/Shared/AppGroup/") else { throw CocoaError(.fileReadNoPermission) }
        let current = root.appendingPathComponent("slax.preferences.v1.json")
        let original = root.appendingPathComponent("user.preferences_pb")
        // These two files exist only in the newly created, owned share simulator.
        if FileManager.default.fileExists(atPath: current.path) { try FileManager.default.removeItem(at: current) }
        if FileManager.default.fileExists(atPath: original.path) { try FileManager.default.removeItem(at: original) }
        let values = scenario == "signed-out" ? ["selected_env": "BETA"] : ["auth_token": "fixture-share-token-NOT-A-REAL-CREDENTIAL", "selected_env": "BETA"]
        if scenario == "legacy-success" {
            func varint(_ value: Int) -> [UInt8] {
                var number = value, bytes: [UInt8] = []
                repeat { let byte = number & 127; number >>= 7; bytes.append(UInt8(byte | (number == 0 ? 0 : 128))) } while number != 0
                return bytes
            }
            func field(_ tag: UInt8, _ bytes: [UInt8]) -> [UInt8] { [tag] + varint(bytes.count) + bytes }
            let bytes = values.sorted(by: {$0.key < $1.key}).flatMap { key, value in
                field(10, field(10, Array(key.utf8)) + field(18, field(42, Array(value.utf8))))
            }
            try Data(bytes).write(to: original, options: .atomic)
        } else {
            try JSONSerialization.data(withJSONObject: ["revision": 1, "values": values]).write(to: current, options: .atomic)
        }
    }

    @objc private func send() {
        let controller = UIActivityViewController(activityItems: [URL(string: "https://share-fixture.test/controlled-article")!], applicationActivities: nil)
        controller.popoverPresentationController?.sourceView = share
        controller.popoverPresentationController?.sourceRect = share.bounds
        present(controller, animated: true)
    }
}
