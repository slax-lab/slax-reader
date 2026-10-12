import XCTest

/** Explicit native input for inspected fixture controls; unknown system alerts are rejected. */
@MainActor final class TargetFixtureControl: XCTestCase {
    func testCancelObservedSlaxOpenDialogAndCapture() throws {
        let source = try targetForeground()
        try loadObservedLocalFixtureServer(source)
        try closeObservedDevelopmentOnboarding(source)
        try closeObservedDevelopmentMenu(source)
        XCTAssertTrue(source.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "A fixed title with English")).firstMatch.waitForExistence(timeout: 20), "The controlled target Library or Reader title must be visible")
        retainFrame(source, name: "controlled-target-clean-foreground-candidate")
    }
    func testCaptureOriginalReaderScrollStep() throws {
        let source = try targetForeground()
        XCTAssertTrue(source.webViews.firstMatch.waitForExistence(timeout: 10), "The controlled target Reader WK view must be visible")
        XCTAssertEqual(source.webViews.count, 1, "Reject an unexpected additional browser surface")
        XCTAssertGreaterThan(source.webViews.firstMatch.frame.width, 300)
        XCTAssertGreaterThan(source.webViews.firstMatch.frame.height, 500)
        retainFrame(source, name: "controlled-target-programmatic-scroll-step-candidate")
    }
    private func targetForeground() throws -> XCUIApplication {
        continueAfterFailure = false
        let source = XCUIApplication(bundleIdentifier: "app.slax.reader.uifixture")
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
        XCTAssertTrue(source.wait(for: .runningForeground, timeout: 10), "Only the controlled target fixture may be captured")
        XCTAssertEqual(springboard.alerts.count, 0, "Reject another system overlay")
        XCTAssertEqual(source.alerts.count, 0, "Reject a retained target alert")
        return source
    }
    private func loadObservedLocalFixtureServer(_ source: XCUIApplication) throws {
        // This exact local development row was inspected in the native launcher; no arbitrary server is selected.
        let server = source.staticTexts["http://192.168.9.82:8083"]
        if server.waitForExistence(timeout: 1) && server.isHittable {
            XCTContext.runActivity(named: "Native tap of inspected local fixture server http://192.168.9.82:8083") {_ in server.tap()}
        }
    }
    private func closeObservedDevelopmentOnboarding(_ source: XCUIApplication) throws {
        let knownText = source.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "This is the developer menu.")).firstMatch
        if knownText.waitForExistence(timeout: 8) {
            let next = source.buttons["Continue"]
            XCTAssertTrue(next.exists && next.isHittable, "Only the inspected development onboarding Continue control may be used")
            XCTContext.runActivity(named: "Native Continue input for the inspected development-menu onboarding") {_ in next.tap()}
        }
    }
    private func closeObservedDevelopmentMenu(_ source: XCUIApplication) throws {
        let version = source.staticTexts["Runtime version: exposdk:57.0.0"]
        let close = source.buttons.matching(identifier: "xmark")
        if version.exists && source.buttons["Reload"].exists && source.buttons["Go home"].exists {
            XCTAssertEqual(close.count, 1, "Only the inspected development menu close control may be used")
            XCTAssertTrue(["关闭", "Close"].contains(close.firstMatch.label) && close.firstMatch.isHittable)
            XCTContext.runActivity(named: "Native close of the inspected Expo development menu") {_ in close.firstMatch.tap()}
        }
    }
    private func retainFrame(_ source: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: source.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
