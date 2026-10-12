import UIKit
import WebKit
import CryptoKit
import SlaxSourceFixture

/** Native image consumers use only exact prepared artwork; all other URL requests fail locally. */
final class FixtureURLProtocol: URLProtocol {
    static var artwork: Data?
    static var imageURLs = Set<String>()
    override class func canInit(with request: URLRequest) -> Bool {
        ["http", "https", "ws", "wss"].contains(request.url?.scheme?.lowercased() ?? "")
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, url.scheme == "https", url.host == "fixture-images.test",
              url.user == nil, url.password == nil, url.port == nil || url.port == 443,
              Self.imageURLs.contains(url.absoluteString), !url.path.hasSuffix("failure.png"), let data = Self.artwork else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable)); return
        }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "image/png"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/** Optional finite observation of native WK callbacks; it never commands or restores scrolling. */
private final class SourceNativeScrollObservation {
    private weak var window: UIWindow?
    private weak var web: WKWebView?
    private let launchedAt: Date
    private let nonce: String
    private let write: ([String: Any]) -> Void
    private let began = ProcessInfo.processInfo.systemUptime
    private var preparedAt: TimeInterval?
    private var timer: Timer?
    private var observations = [NSKeyValueObservation]()
    private var samples = [[String: Any]]()
    private var nativeEvents = [[String: Any]]()
    private var nativeEventCount = 0
    private var sourceStatus = [String: Any]()
    private var identity: String?
    private var bodyReady = false
    private var bodyProbePending = false
    private var closed = false

    init(window: UIWindow, launchedAt: Date, nonce: String, write: @escaping ([String: Any]) -> Void) {
        self.window = window; self.launchedAt = launchedAt; self.nonce = nonce; self.write = write
    }
    func start() {
        guard !closed, timer == nil else {return}
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) {[weak self] _ in self?.tick()}
    }
    func close() {
        closed = true; timer?.invalidate(); timer = nil
        observations.forEach {$0.invalidate()}; observations.removeAll()
    }
    private func finish(_ state: String, reason: String) {
        publish(state: state, reason: reason); close()
    }
    private func allWebViews(_ view: UIView) -> [WKWebView] {
        (view as? WKWebView).map {[$0]} ?? view.subviews.flatMap {allWebViews($0)}
    }
    private func preparedStatus() -> [String: Any]? {
        guard let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {return nil}
        let url = directory.appendingPathComponent("fixture-status.json")
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let modified = attributes[.modificationDate] as? Date, modified >= launchedAt,
              let data = try? Data(contentsOf: url), data.count <= 64 * 1024,
              let status = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              status["controlledFixture"] as? Bool == true, status["fixtureVersion"] as? Int == 1,
              status["state"] as? String == "prepared", status["scenario"] as? String == "reader-mixed",
              status["route"] as? String == "Reader", status["locale"] as? String == "en",
              status["selectedActionIndex"] as? Int == -1 else {return nil}
        return status
    }
    private func current(_ candidate: WKWebView, _ sourceWindow: UIWindow) -> Bool {
        !closed && window === sourceWindow && web === candidate && candidate.window === sourceWindow &&
            sourceWindow.isKeyWindow && UIApplication.shared.applicationState == .active
    }
    private func sourceCallbackFloat32Position(offsetPoints: CGFloat, insetPoints: CGFloat, density: CGFloat) -> Float {
        // Original WebviewHelper.ios.kt converts both native values before the
        // Float32 addition/multiplication, then clamps the pixel result.
        let offsetFloat = Float(offsetPoints)
        let insetFloat = Float(insetPoints)
        let densityFloat = Float(density)
        let adjustedOffsetPoints = offsetFloat + insetFloat
        let pixels = adjustedOffsetPoints * densityFloat
        return max(pixels, 0)
    }
    private func geometry(_ candidate: WKWebView, _ sourceWindow: UIWindow) -> [String: Any] {
        let scroll = candidate.scrollView
        let frame = candidate.convert(candidate.bounds, to: sourceWindow)
        return ["offsetYPoints": scroll.contentOffset.y, "topInsetPoints": scroll.contentInset.top,
            "adjustedTopInsetPoints": scroll.adjustedContentInset.top, "bottomInsetPoints": scroll.contentInset.bottom,
            "contentWidthPoints": scroll.contentSize.width, "contentHeightPoints": scroll.contentSize.height,
            "viewportWidthPoints": scroll.bounds.width, "viewportHeightPoints": scroll.bounds.height,
            "positionPixels": max(0, scroll.contentOffset.y + scroll.contentInset.top) * sourceWindow.screen.scale,
            "sourceCallbackFloat32PositionPixels": Double(sourceCallbackFloat32Position(
                offsetPoints: scroll.contentOffset.y, insetPoints: scroll.contentInset.top, density: sourceWindow.screen.scale)),
            "sourceCallbackFloat32Density": Double(Float(sourceWindow.screen.scale)),
            "frameInWindow": ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height],
            "loading": candidate.isLoading, "windowAttached": candidate.window === sourceWindow,
            "dragging": scroll.isDragging, "decelerating": scroll.isDecelerating]
    }
    private func bind(_ candidate: WKWebView, _ sourceWindow: UIWindow) {
        web = candidate; identity = UUID().uuidString
        observations = [
            candidate.scrollView.observe(\.contentOffset, options: [.new]) {[weak self, weak candidate, weak sourceWindow] _, _ in
                guard let self, let candidate, let sourceWindow else {return}
                self.recordNativeEvent("native-contentOffset-KVO", candidate, sourceWindow)
            },
            candidate.scrollView.observe(\.contentSize, options: [.new]) {[weak self, weak candidate, weak sourceWindow] _, _ in
                guard let self, let candidate, let sourceWindow else {return}
                self.recordNativeEvent("native-contentSize-KVO", candidate, sourceWindow)
            },
            candidate.scrollView.observe(\.bounds, options: [.new]) {[weak self, weak candidate, weak sourceWindow] _, _ in
                guard let self, let candidate, let sourceWindow else {return}
                self.recordNativeEvent("native-bounds-KVO", candidate, sourceWindow)
            }
        ]
    }
    private func recordNativeEvent(_ kind: String, _ candidate: WKWebView, _ sourceWindow: UIWindow) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async {[weak self, weak candidate, weak sourceWindow] in
                guard let self, let candidate, let sourceWindow else {return}
                self.recordNativeEvent(kind, candidate, sourceWindow)
            }
            return
        }
        guard current(candidate, sourceWindow) else {return}
        nativeEventCount += 1
        if nativeEvents.count == 128 {nativeEvents.removeFirst()}
        nativeEvents.append(["sequence": nativeEventCount, "kind": kind,
            "elapsedSeconds": ProcessInfo.processInfo.systemUptime - began,
            "geometry": geometry(candidate, sourceWindow)])
    }
    private func tick() {
        guard !closed, let sourceWindow = window else {close(); return}
        let now = ProcessInfo.processInfo.systemUptime
        guard now - began <= 90 else {finish("observation-expired", reason: "Total90-second bound"); return}
        guard let status = preparedStatus() else {
            if preparedAt != nil {finish("observation-rejected", reason: "Current source prepared state changed")}
            else if now - began >= 30 {finish("observation-rejected", reason: "No real source prepared state within30seconds")}
            return
        }
        sourceStatus = status
        if preparedAt == nil {preparedAt = now}
        guard now - preparedAt! <= 60, samples.count < 300 else {finish("observation-completed", reason: "Finite60-second/300-sample window"); return}
        // A native XCTest host may briefly foreground before it activates this
        // source app. Keep the same finite deadline and pause readonly sampling.
        guard sourceWindow.isKeyWindow, UIApplication.shared.applicationState == .active else {return}
        let candidates = allWebViews(sourceWindow)
        guard candidates.count == 1, let candidate = candidates.first else {finish("observation-rejected", reason: "Require one actual original WK"); return}
        if identity == nil {bind(candidate, sourceWindow)}
        guard current(candidate, sourceWindow) else {finish("observation-rejected", reason: "Original WK/window identity or foreground changed"); return}
        if candidate.isLoading {bodyReady = false}
        if !bodyReady && !bodyProbePending && !candidate.isLoading {
            bodyProbePending = true
            candidate.evaluateJavaScript("document.readyState === 'complete' && !!document.body && document.body.childElementCount > 0 && !!window.SlaxWebViewBridge && !!window.SlaxWebViewBridge.markManager") {[weak self, weak candidate, weak sourceWindow] value, error in
                guard let self, let candidate, let sourceWindow, !self.closed,
                      self.web === candidate, self.window === sourceWindow else {return}
                self.bodyProbePending = false
                self.bodyReady = self.current(candidate, sourceWindow) && error == nil && (value as? Bool) == true
            }
        }
        let sample: [String: Any] = ["sequence": samples.count, "elapsedSeconds": now - began,
            "observedAtUnixSeconds": Date().timeIntervalSince1970, "bodyAndBridgeReady": bodyReady,
            "geometry": geometry(candidate, sourceWindow)]
        samples.append(sample)
        publish(state: "observing", reason: "")
    }
    private func publish(state: String, reason: String) {
        guard let sourceWindow = window else {return}
        write(["kind": "original-source-native-reader-observation", "controlledFixture": true, "fixtureVersion": 1,
            "bundleIdentifier": Bundle.main.bundleIdentifier!, "observationNonce": nonce, "state": state, "reason": reason,
            "nativeInteractionVerified": false, "sourcePreparedStatus": sourceStatus, "webIdentity": identity ?? "",
            "scale": sourceWindow.screen.scale, "preferredContentSizeCategory": UIApplication.shared.preferredContentSizeCategory.rawValue,
            "safeTopPoints": sourceWindow.safeAreaInsets.top, "safeBottomPoints": sourceWindow.safeAreaInsets.bottom,
            "appearance": sourceWindow.traitCollection.userInterfaceStyle == .light ? "light" : "other",
            "samples": samples, "nativeKvoEvents": nativeEvents, "nativeKvoEventCount": nativeEventCount,
            "sourceCallbackFloat32Projection": "Original Float(offset)+Float(inset), multiply Float(density), clamp pixels last; density uses measured native screen scale, expected3 for this controlled source. This is a separately named arithmetic projection, not a captured Kotlin callback or acceptance.",
            "observation": "Only reads nativeWKgeometry/KVO and a nonmutating DOM readiness expression; no scroll command or acceptance event"])
    }
}

@main final class SourceFixtureApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var geometryTimer: Timer?
    private var readerStep: FixtureReaderStep?
    private var nativeScrollObserver: SourceNativeScrollObservation?
    private let launchedAt = Date()
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        precondition(Bundle.main.bundleIdentifier == "app.slax.reader.sourcefixture")
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.overrideUserInterfaceStyle = .light
        self.window = window
        let placeholder = UIViewController()
        placeholder.view.backgroundColor = .white
        window.rootViewController = placeholder
        window.makeKeyAndVisible()
        do {
            try verifyPreparedInputs()
            prepareArtwork()
            precondition(URLProtocol.registerClass(FixtureURLProtocol.self))
            // WK's URL-filter grammar does not support alternation; each denied scheme has its own rule.
            let rules = #"[{"trigger":{"url-filter":"^http://"},"action":{"type":"block"}},{"trigger":{"url-filter":"^https://"},"action":{"type":"block"}},{"trigger":{"url-filter":"^ws://"},"action":{"type":"block"}},{"trigger":{"url-filter":"^wss://"},"action":{"type":"block"}}]"#
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "slax-source-fixture-no-network", encodedContentRuleList: rules) {[weak self] list, error in
                DispatchQueue.main.async {
                    guard let self else {return}
                    guard let list, error == nil else {
                        let nativeError = error as NSError?
                        self.fail("Native WK blocking rule compilation failed (\(nativeError?.domain ?? "unknown"):\(nativeError?.code ?? 0))")
                        return
                    }
                    FixturePolicyKt.setFixtureWebRules(rules: list)
                    let arguments = ProcessInfo.processInfo.arguments
                    func argument(_ key: String, default fallback: String) -> String {
                        guard let index = arguments.firstIndex(of: key), arguments.indices.contains(index + 1) else {return fallback}
                        return arguments[index + 1]
                    }
                    let scenario = argument("--scenario", default: "library-populated")
                    let locale = argument("--fixture-locale", default: "en")
                    let actionIndex = Int32(argument("--fixture-action-index", default: "-1")) ?? -1
                    let nativeScrollNonce = argument("--fixture-native-scroll-observation", default: "")
                    guard let step = FixtureReaderStep.Step(rawValue: argument("--fixture-reader-step", default: "none")),
                          step == .none || (scenario == "reader-mixed" && ["en", "zh"].contains(locale) && actionIndex == -1) else {
                        self.fail("Reader step requires an exact supported initial reader-mixed fixture")
                        return
                    }
                    guard nativeScrollNonce.isEmpty || (UUID(uuidString: nativeScrollNonce) != nil &&
                        scenario == "reader-mixed" && locale == "en" && actionIndex == -1 && step == .none) else {
                        self.fail("Native scroll observation requires a nonce and the exact initial English Reader without programmatic steps")
                        return
                    }
                    self.window?.rootViewController = SourceFixtureKt.SourceFixtureViewController(scenarioName: scenario, locale: locale, actionIndex: actionIndex)
                    self.recordViewport()
                    if nativeScrollNonce.isEmpty {
                        self.observePreparedGeometry(scenario: scenario, locale: locale, actionIndex: actionIndex, step: step)
                    } else if let sourceWindow = self.window {
                        self.nativeScrollObserver = SourceNativeScrollObservation(window: sourceWindow, launchedAt: self.launchedAt,
                            nonce: nativeScrollNonce, write: {[weak self] record in
                                self?.writeRecord(record, filename: "fixture-native-reader-observation.json")
                            })
                        self.nativeScrollObserver?.start()
                    }
                }
            }
        } catch {fail("Prepared source input verification failed: \(error.localizedDescription)")}
        return true
    }
    func applicationWillTerminate(_ application: UIApplication) {geometryTimer?.invalidate(); readerStep?.close(); nativeScrollObserver?.close(); SourceFixtureKt.closeSourceFixture()}
    private func verifyPreparedInputs() throws {
        let root = Bundle.main.bundleURL.appendingPathComponent("slax-ui-fixtures")
        let marker = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("manifest.json"))) as! [String: Any]
        let entries = marker["files"] as! [[String: String]]
        precondition(entries.count > 0)
        for entry in entries {
            let relative = entry["path"]!
            precondition(!relative.hasPrefix("/") && !relative.split(separator: "/").contains(".."))
            let bytes = try Data(contentsOf: root.appendingPathComponent(relative))
            let digest = SHA256.hash(data: bytes).map {String(format: "%02x", $0)}.joined()
            precondition(digest == entry["sha256"])
        }
        let inputs = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("source-capture-inputs.json"))) as! [String: String]
        let scenarios = try Data(contentsOf: root.appendingPathComponent("scenarios.json"))
        precondition(SHA256.hash(data: scenarios).map {String(format: "%02x", $0)}.joined() == inputs["fixtureInputSha256"])
    }
    private func prepareArtwork() {
        guard let path = Bundle.main.path(forResource: "resources", ofType: "ts", inDirectory: "slax-ui-fixtures"),
              let text = try? String(contentsOfFile: path, encoding: .utf8) else {return}
        let full = NSRange(text.startIndex..., in: text)
        let artwork = try! NSRegularExpression(pattern: #"fixtureArtworkBase64\s*=\s*"([A-Za-z0-9+/=]+)""#)
        if let match = artwork.firstMatch(in: text, range: full), let range = Range(match.range(at: 1), in: text) {
            FixtureURLProtocol.artwork = Data(base64Encoded: String(text[range]))
        }
        let urls = try! NSRegularExpression(pattern: #""(https://fixture-images\.test/[^"]+)"\s*:"#)
        FixtureURLProtocol.imageURLs = Set(urls.matches(in: text, range: full).compactMap {match in
            Range(match.range(at: 1), in: text).map {String(text[$0])}
        })
    }
    private func recordViewport() {
        guard let window else {return}
        let record: [String: Any] = ["controlledFixture": true, "fixtureVersion": 1, "platform": "ios",
            "nativeInteractionVerified": false, "widthPoints": window.bounds.width, "heightPoints": window.bounds.height,
            "scale": window.screen.scale, "preferredContentSizeCategory": UIApplication.shared.preferredContentSizeCategory.rawValue,
            "safeAreaTop": window.safeAreaInsets.top, "safeAreaBottom": window.safeAreaInsets.bottom,
            "operatingSystemVersion": ProcessInfo.processInfo.operatingSystemVersionString]
        writeRecord(record, filename: "fixture-viewport.json")
    }
    /** Read only the actual original WK view after its current launch's source readiness predicate. */
    private func observePreparedGeometry(scenario: String, locale: String, actionIndex: Int32, step: FixtureReaderStep.Step) {
        guard let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {return}
        geometryTimer?.invalidate()
        let statusURL = directory.appendingPathComponent("fixture-status.json")
        var attempts = 0
        var samples = [[String: Any]]()
        func webViews(in view: UIView) -> [WKWebView] {
            (view as? WKWebView).map {[$0]} ?? view.subviews.flatMap {webViews(in: $0)}
        }
        geometryTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) {[weak self] timer in
            guard let self, let window = self.window else {timer.invalidate(); return}
            attempts += 1
            guard attempts <= 150 else {timer.invalidate(); return}
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: statusURL.path),
                  let modified = attributes[.modificationDate] as? Date, modified >= self.launchedAt,
                  let data = try? Data(contentsOf: statusURL),
                  let status = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  status["controlledFixture"] as? Bool == true, status["fixtureVersion"] as? Int == 1,
                  status["state"] as? String == "prepared", status["scenario"] as? String == scenario,
                  status["locale"] as? String == locale, status["selectedActionIndex"] as? Int == Int(actionIndex) else {return}
            self.recordViewport()
            let views = webViews(in: window)
            let geometries = self.readerGeometries(views, window: window)
            samples.append(["elapsedSeconds": Date().timeIntervalSince(self.launchedAt),
                "applicationActive": UIApplication.shared.applicationState == .active,
                "keyWindow": window.isKeyWindow, "webViews": geometries])
            self.writeRecord(["controlledFixture": true, "fixtureVersion": 1, "bundleIdentifier": Bundle.main.bundleIdentifier!,
                "scenario": scenario, "locale": locale, "selectedActionIndex": actionIndex,
                "sourcePreparedStatus": status, "scale": window.screen.scale, "samples": samples,
                "observation": "readonly-original-WK-scrollView-after-current-launch-prepared-status",
                "nativeInteractionVerified": false], filename: "fixture-reader-geometry.json")
            if samples.count >= 20 {
                timer.invalidate()
                guard step != .none, views.count == 1, let web = views.first else {return}
                let driver = FixtureReaderStep(write: {[weak self] value, name in self?.writeRecord(value, filename: name)},
                    isCurrent: {[weak self, weak web, weak window] in
                        guard let self, let web, let window else {return false}
                        return self.window === window && web.window === window && window.isKeyWindow &&
                            UIApplication.shared.applicationState == .active
                    }, geometry: {[weak self, weak web, weak window] in
                        guard let self, let web, let window else {return []}
                        return self.readerGeometries([web], window: window)
                    })
                self.readerStep = driver
                driver.begin(step, web: web, scenario: scenario, locale: locale, preparedStatus: status, initialSamples: samples)
            }
        }
    }
    private func readerGeometries(_ views: [WKWebView], window: UIWindow) -> [[String: Any]] {
        views.map {web in
            let scroll = web.scrollView
            return ["offsetXPoints": scroll.contentOffset.x, "offsetYPoints": scroll.contentOffset.y,
                "topInsetPoints": scroll.contentInset.top, "bottomInsetPoints": scroll.contentInset.bottom,
                "adjustedTopInsetPoints": scroll.adjustedContentInset.top,
                "contentWidthPoints": scroll.contentSize.width, "contentHeightPoints": scroll.contentSize.height,
                "viewportWidthPoints": scroll.bounds.width, "viewportHeightPoints": scroll.bounds.height,
                "positionPixels": max(0, scroll.contentOffset.y + scroll.contentInset.top) * window.screen.scale,
                "loading": web.isLoading, "windowAttached": web.window === window]
        }
    }
    private func fail(_ message: String) {
        writeRecord(["controlledFixture": true, "fixtureVersion": 1, "state": "failed", "message": message], filename: "fixture-bootstrap-error.json")
    }
    private func writeRecord(_ record: [String: Any], filename: String) {
        guard let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {return}
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: directory.appendingPathComponent(filename), options: .atomic)
        }
    }
}
