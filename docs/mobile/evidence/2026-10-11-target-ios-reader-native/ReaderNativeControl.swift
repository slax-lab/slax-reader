import XCTest

/** Each case requires a fresh, independently prepared production Reader in the unique UI fixture. */
@MainActor final class ReaderNativeControl: XCTestCase {
    func testInspectPreparedReader() throws {
        let target = try preparedReader()
        retain(target, name: "reader-before-native-input")
    }
    func testNativeHeaderBack() throws {
        let target = try preparedReader()
        retain(target, name: "reader-before-native-header-back")
        try nativeBack(target).tap()
        try requireLibrary(target)
        retain(target, name: "reader-after-native-header-back")
    }
    func testCancelledNativeEdgePop() throws {
        let target = try preparedReader()
        retain(target, name: "reader-before-cancelled-native-edge")
        let origin = target.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let start = origin.withOffset(CGVector(dx: 2, dy: target.frame.height * 0.45))
        let end = origin.withOffset(CGVector(dx: target.frame.width * 0.08, dy: target.frame.height * 0.45))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.5)
        XCTAssertTrue(try nativeBack(target).isHittable, "A short released edge drag must leave the actual Reader route visible")
        try requireOwnForeground(target)
        retain(target, name: "reader-after-cancelled-native-edge")
    }
    func testCommittedNativeEdgePop() throws {
        let target = try preparedReader()
        retain(target, name: "reader-before-committed-native-edge")
        let origin = target.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let start = origin.withOffset(CGVector(dx: 2, dy: target.frame.height * 0.45))
        let end = origin.withOffset(CGVector(dx: target.frame.width * 0.9, dy: target.frame.height * 0.45))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.5)
        try requireLibrary(target)
        retain(target, name: "reader-after-committed-native-edge")
    }
    func testNativeScrollThenBackground() throws {
        let target = try preparedReader()
        retain(target, name: "reader-before-native-scroll-background")
        scrollDocument(target)
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(target.wait(for: .runningBackground, timeout: 5))
        target.activate()
        try requireOwnForeground(target)
        XCTAssertTrue(try nativeBack(target).isHittable)
        retain(target, name: "reader-after-native-scroll-background")
    }
    func testNativeScrollThenHeaderBack() throws {
        let target = try preparedReader()
        retain(target, name: "reader-before-native-scroll-exit")
        scrollDocument(target)
        try nativeBack(target).tap()
        try requireLibrary(target)
        retain(target, name: "reader-after-native-scroll-exit")
    }
    func testNativeBackClearsPreparedSelection() throws {
        let target = try preparedReader()
        let selection = target.otherElements["selection_action_bar"].firstMatch
        XCTAssertTrue(selection.waitForExistence(timeout: 5), "Only an explicitly prepared real document selection may be dismissed")
        retain(target, name: "reader-before-native-selection-dismissal")
        try nativeBack(target).tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: selection)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 5), .completed)
        XCTAssertTrue(try nativeBack(target).isHittable, "Selection dismissal must retain Reader rather than also pop the route")
        try requireOwnForeground(target)
        retain(target, name: "reader-after-native-selection-dismissal")
    }
    private func preparedReader() throws -> XCUIApplication {
        continueAfterFailure = false
        XCTAssertEqual(XCUIApplication(bundleIdentifier: "app.slax.reader").state, .notRunning, "Do not activate the production main application")
        let target = XCUIApplication(bundleIdentifier: "app.slax.reader.uifixture")
        target.activate()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        if alert.waitForExistence(timeout: 1) {
            let known = ["在“Slax Reader”中打开?", "在“Slax Reader”中打开？", "Open in “Slax Reader”?", "Open in \"Slax Reader\"?"]
            XCTAssertTrue(alert.staticTexts.allElementsBoundByIndex.map(\.label).contains(where: known.contains), "Refuse an unknown system alert")
            XCTAssertEqual(alert.buttons.count, 2)
            let cancel = alert.buttons["取消"].exists ? alert.buttons["取消"] : alert.buttons["Cancel"]
            let open = alert.buttons["打开"].exists ? alert.buttons["打开"] : alert.buttons["Open"]
            XCTAssertTrue(cancel.exists && open.exists, "Refuse an unobserved alert action pair")
            cancel.tap()
        }
        try requireOwnForeground(target)
        _ = try nativeBack(target)
        return target
    }
    private func scrollDocument(_ target: XCUIApplication) {
        let origin = target.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let start = origin.withOffset(CGVector(dx: target.frame.width * 0.55, dy: target.frame.height * 0.78))
        let end = origin.withOffset(CGVector(dx: target.frame.width * 0.55, dy: target.frame.height * 0.34))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
    }
    private func nativeBack(_ target: XCUIApplication) throws -> XCUIElement {
        // Actual native RNSScreen accessibility identifies this as BackButton
        // with the prior route's Library label, rather than a generic Back label.
        let back = target.navigationBars.buttons["BackButton"].firstMatch
        guard back.waitForExistence(timeout: 5) && back.isHittable else {
            retain(target, name: "reader-rejected-missing-native-back")
            throw NSError(domain: "ControlledReaderInput", code: 1, userInfo: [NSLocalizedDescriptionKey: "No inspected native Back button; do not choose another control"])
        }
        XCTAssertLessThan(back.frame.minX, target.frame.width * 0.25)
        XCTAssertLessThan(back.frame.maxY, target.frame.height * 0.25)
        XCTAssertEqual(back.label, "Library", "Refuse a different navigation destination in this prepared English route")
        return back
    }
    private func requireLibrary(_ target: XCUIApplication) throws {
        XCTAssertTrue(target.buttons["Switch List"].waitForExistence(timeout: 5))
        XCTAssertTrue(target.buttons["Menu"].isHittable)
        XCTAssertTrue(target.buttons["Add Link"].isHittable)
        XCTAssertEqual(target.navigationBars.buttons.matching(identifier: "BackButton").count, 0)
        try requireOwnForeground(target)
    }
    private func requireOwnForeground(_ target: XCUIApplication) throws {
        XCTAssertTrue(target.wait(for: .runningForeground, timeout: 5))
        XCTAssertEqual(target.alerts.count, 0)
        XCTAssertEqual(XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.count, 0)
        XCTAssertEqual(XCUIApplication(bundleIdentifier: "app.slax.reader").state, .notRunning)
    }
    private func retain(_ target: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: target.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: target.debugDescription)
        tree.name = name + "-native-tree"
        tree.lifetime = .keepAlways
        add(tree)
    }
}
