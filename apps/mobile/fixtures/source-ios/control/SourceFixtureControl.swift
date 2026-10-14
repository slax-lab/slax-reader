import XCTest

/** Actual native Cancel input only; no generic interruption monitor or automatic alert acceptance. */
@MainActor final class SourceFixtureControl: XCTestCase {
    func testCancelObservedSlaxOpenDialogAndCapture() throws {
        let source = try originalForeground()
        XCTAssertTrue(source.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "A fixed title with English")).firstMatch.waitForExistence(timeout: 10), "The original Library or Reader title must be visible")
        retainFrame(source, name: "original-source-clean-foreground-candidate")
    }
    func testCaptureOriginalReaderScrollStep() throws {
        let source = try originalForeground()
        // Original Compose embeds WK without an XCUI WebView element. Actual WK identity,
        // dimensions and prepared state are checked by the separate readonly UIKit observer.
        let tree = XCTAttachment(string: source.debugDescription)
        tree.name = "original-source-scroll-step-native-tree"
        tree.lifetime = .keepAlways
        add(tree)
        retainFrame(source, name: "original-source-programmatic-scroll-step-candidate")
    }
    private func originalForeground() throws -> XCUIApplication {
        continueAfterFailure = false
        let source = XCUIApplication(bundleIdentifier: "app.slax.reader.sourcefixture")
        source.activate()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let systemAlert = springboard.alerts.firstMatch
        for attempt in 1...3 {
            guard systemAlert.waitForExistence(timeout: attempt == 1 ? 2 : 0.5) else {break}
            let knownTitles = ["在“Slax Reader”中打开?", "在“Slax Reader”中打开？", "Open in “Slax Reader”?", "Open in \"Slax Reader\"?"]
            let labels = systemAlert.staticTexts.allElementsBoundByIndex.map(\.label)
            XCTAssertTrue(labels.contains(where: knownTitles.contains), "Refuse an unknown system alert")
            XCTAssertEqual(systemAlert.buttons.count, 2, "Refuse an unexpected alert action set")
            let cancel = systemAlert.buttons["取消"].exists ? systemAlert.buttons["取消"] : systemAlert.buttons["Cancel"]
            let open = systemAlert.buttons["打开"].exists ? systemAlert.buttons["打开"] : systemAlert.buttons["Open"]
            XCTAssertTrue(cancel.exists && open.exists, "Refuse an unknown action pair")
            XCTContext.runActivity(named: "Native Cancel input \(attempt) for the inspected Open-in-Slax-Reader system dialog; frame \(cancel.frame)") {_ in
                cancel.tap()
            }
            let disappeared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: systemAlert)
            if XCTWaiter.wait(for: [disappeared], timeout: 3) == .completed {break}
        }
        XCTAssertTrue(source.wait(for: .runningForeground, timeout: 10), "Only the original controlled source fixture may be captured")
        XCTAssertEqual(springboard.alerts.count, 0, "Reject another system overlay")
        XCTAssertEqual(source.alerts.count, 0, "Reject a retained source alert")
        return source
    }
    private func retainFrame(_ source: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: source.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
