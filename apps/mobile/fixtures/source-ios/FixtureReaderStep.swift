import UIKit
import WebKit

/** Programmatic input to the existing original bridge, separate from the readonly geometry observer. */
final class FixtureReaderStep {
    enum Step: String {case none, top, anchorMiddle = "anchor-middle", anchorThenTop = "anchor-then-top"}
    private var timer: Timer?
    private var closed = false
    private let write: ([String: Any], String) -> Void
    private let isCurrent: () -> Bool
    private let geometry: () -> [[String: Any]]
    private var samples = [[String: Any]]()
    private var completed = false

    init(write: @escaping ([String: Any], String) -> Void,
         isCurrent: @escaping () -> Bool, geometry: @escaping () -> [[String: Any]]) {
        self.write = write; self.isCurrent = isCurrent; self.geometry = geometry
    }
    func close() {closed = true; timer?.invalidate()}

    func begin(_ step: Step, web: WKWebView, scenario: String, locale: String,
               preparedStatus: [String: Any], initialSamples: [[String: Any]]) {
        precondition(Bundle.main.bundleIdentifier == "app.slax.reader.sourcefixture")
        precondition(step != .none && scenario == "reader-mixed" && ["en", "zh"].contains(locale))
        let startedAt = Date()
        let writer = write
        var documentBefore: [String: Any]?
        var anchorSamples = [[String: Any]]()
        let base: [String: Any] = ["controlledFixture": true, "fixtureVersion": 1,
            "bundleIdentifier": Bundle.main.bundleIdentifier!, "scenario": scenario, "locale": locale,
            "step": step.rawValue, "input": "programmatic-existing-original-NativeBridge-event",
            "nativeInteractionVerified": false, "directScrollInjection": false,
            "startedAt": ISO8601DateFormatter().string(from: startedAt), "sourcePreparedStatus": preparedStatus,
            "initialReadonlySamples": initialSamples]
        func record(_ state: String, extra: [String: Any] = [:]) {
            var value = base; value["state"] = state
            if let documentBefore {value["documentBefore"] = documentBefore}
            if !anchorSamples.isEmpty {value["anchorReadonlySamples"] = anchorSamples}
            for (key, item) in extra {value[key] = item}
            writer(value, "fixture-reader-step.json")
        }
        guard !closed, isCurrent(), !web.isLoading, initialSamples.count == 20 else {
            record("failed", extra: ["reason": "initial-original-reader-not-active-or-ready"])
            return
        }
        record("awaiting-original-bridge-callback")
        // The source handler owns the scroll command; this driver does not call window.scrollTo or setContentOffset.
        let event = step == .top ? #"{type:'scrollToTop'}"# : #"{type:'scrollToPosition',percentage:0.5}"#
        let script = """
        (function(){
          if(document.readyState==='loading'||!window.SlaxWebViewBridge||!window.SlaxWebViewBridge.markManager||
             !window.webkit||!window.webkit.messageHandlers||!window.webkit.messageHandlers.NativeBridge)return false;
          var before={documentHeightPoints:document.body.scrollHeight,pageYOffsetPoints:window.pageYOffset};
          window.webkit.messageHandlers.NativeBridge.postMessage(JSON.stringify(\(event)));
          return before;
        })()
        """
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) {[weak self] timer in
            guard let self, !self.closed, self.isCurrent() else {timer.invalidate(); return}
            guard Date().timeIntervalSince(startedAt) <= 10 else {
                record("failed", extra: ["reason": "bounded-original-bridge-or-geometry-timeout", "afterReadonlySamples": self.samples])
                timer.invalidate(); return
            }
            guard self.completed else {return}
            self.samples.append(["elapsedSeconds": Date().timeIntervalSince(startedAt), "webViews": self.geometry()])
            record("observing-original-scroll", extra: ["afterReadonlySamples": self.samples])
            if self.samples.count == 20 {
                if step == .anchorThenTop && anchorSamples.isEmpty {
                    anchorSamples = self.samples
                    record("anchor-observed-before-original-top")
                    self.samples = []; self.completed = false
                    web.evaluateJavaScript("window.webkit.messageHandlers.NativeBridge.postMessage(JSON.stringify({type:'scrollToTop'}));true") {[weak self] result, error in
                        guard let self, !self.closed, self.isCurrent() else {return}
                        guard error == nil, (result as? Bool) == true else {
                            record("failed", extra: ["reason": "original-top-bridge-post-failed"])
                            self.timer?.invalidate(); return
                        }
                        record("original-top-posted-after-anchor")
                        self.completed = true
                    }
                    return
                }
                record("observed", extra: ["afterReadonlySamples": self.samples,
                    "observation": "readonly-native-WK-after-original-bridge-event; observed-does-not-imply-target-parity"])
                timer.invalidate()
            }
        }
        web.evaluateJavaScript(script) {[weak self] result, error in
            guard let self, !self.closed, self.isCurrent() else {return}
            guard error == nil, let before = result as? [String: Any],
                  before["documentHeightPoints"] is NSNumber, before["pageYOffsetPoints"] is NSNumber else {
                record("failed", extra: ["reason": "original-document-or-bridge-not-ready"])
                self.timer?.invalidate(); return
            }
            documentBefore = before
            record("original-bridge-posted")
            self.completed = true
        }
    }
}
