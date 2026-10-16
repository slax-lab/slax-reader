import XCTest

/// Uses real system share input against the separately installed, closed application.
@MainActor final class ShareFixtureControl: XCTestCase {
    private var input: [String: String] {
        let url = Bundle(for: Self.self).url(forResource: "fixture-input", withExtension: "json")!
        return try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: String]
    }

    func testSuccess() throws { try run("success", expected: "Success!") }
    func testLegacySuccess() throws { try run("legacy-success", expected: "Success!") }
    func testSignedOut() throws { try run("signed-out", expected: "Not have auth info, please login first.") }
    func testExpired() throws { try run("expired", expected: "Auth expired, please reopen the app to login again.") }
    func testRejected() throws { try run("rejected", expected: "Controlled collection rejection") }
    func testFailed() throws { try run("failed", expected: "Collection failed, please try again.") }
    func testCancel() throws { try run("cancel", expected: "Collecting", cancel: true) }

    private func run(_ scenario: String, expected: String, cancel: Bool = false) throws {
        continueAfterFailure = false
        let main = XCUIApplication(bundleIdentifier: "app.slax.reader")
        XCTAssertEqual(main.state, .notRunning, "The real main application must remain closed")
        let sender = XCUIApplication(bundleIdentifier: "app.slax.reader.sharefixturehost")
        sender.launchArguments = ["--scenario", scenario, "--api-origin", input["apiOrigin"]!, "--fixture-run-id", input["runId"]!, "--fixture-device", input["device"]!]
        sender.launch()
        XCTAssertTrue(sender.staticTexts["Ready: " + scenario].waitForExistence(timeout: 10))
        XCTAssertEqual(sender.alerts.count, 0, "Refuse an unexpected sender alert")
        sender.buttons["share-fixture-send"].tap()
        let slax = sender.cells["Slax Reader"].firstMatch
        guard slax.waitForExistence(timeout: 5) else {
            XCTFail("The actual Slax Reader extension is absent from the system share sheet: " + sender.debugDescription)
            return
        }
        XCTAssertEqual(slax.identifier, "shareCell", "Only the inspected Slax Reader share activity may be selected")
        XCTAssertTrue(slax.isHittable)
        slax.tap()
        XCTAssertTrue(sender.staticTexts[expected].waitForExistence(timeout: 10), "Missing native extension result: " + sender.debugDescription)
        XCTAssertEqual(main.state, .notRunning)
        let screenshot = XCTAttachment(screenshot: sender.screenshot())
        screenshot.name = "cold-main-share-" + scenario
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: sender.debugDescription)
        tree.name = "cold-main-share-" + scenario + "-native-tree"
        tree.lifetime = .keepAlways
        add(tree)
        if cancel {
            XCTContext.runActivity(named: "Dismiss the inspected Collecting extension through its native background") { _ in
                sender.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
            }
            let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: sender.staticTexts["Collecting"])
            XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 5), .completed)
            XCTAssertFalse(sender.staticTexts["Success!"].exists)
        }
        XCTAssertEqual(main.state, .notRunning)
        sender.terminate()
    }
}
