import XCTest

/** Actual system Share input; the selected extension retains the unchanged original Swift controller. */
@MainActor final class SourceShareControl: XCTestCase {
    func testLoading() throws {try capture("loading", expected: "Collecting")}
    func testSuccess() throws {try capture("success", expected: "Success!")}
    func testError() throws {try capture("error", expected: "Collection failed, please try again.")}

    private func capture(_ state: String, expected: String) throws {
        continueAfterFailure = false
        let main = XCUIApplication(bundleIdentifier: "app.slax.reader")
        XCTAssertEqual(main.state, .notRunning, "The production main application must stay closed")
        let host = XCUIApplication(bundleIdentifier: "app.slax.reader.sourcesharefixture")
        host.launchArguments = ["--fixture-share-state", state]
        host.launch()
        XCTAssertTrue(host.staticTexts["Original source Share UI: " + state].waitForExistence(timeout: 10))
        XCTAssertEqual(host.alerts.count, 0, "Refuse an unexpected host alert")
        let present = host.buttons["source-share-present"]
        XCTAssertTrue(present.isHittable)
        present.tap()
        let activity = host.cells["Source Share UI Fixture"].firstMatch
        guard activity.waitForExistence(timeout: 5) else {
            retain(host, state: state + "-missing-activity")
            XCTFail("The unique original Share fixture activity must be visible")
            return
        }
        XCTAssertEqual(activity.identifier, "shareCell", "Select only the inspected unique extension activity")
        XCTAssertTrue(activity.isHittable)
        XCTAssertEqual(host.alerts.count, 0)
        activity.tap()
        XCTAssertTrue(host.staticTexts[expected].waitForExistence(timeout: 10), "The actual original Swift status must appear")
        XCTAssertEqual(main.state, .notRunning)
        XCTAssertEqual(host.alerts.count, 0, "Refuse an unexpected extension alert")
        retain(host, state: state)
        if state == "loading" || state == "error" {
            XCTContext.runActivity(named: "Native background dismissal of the inspected original Share panel") {_ in
                host.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
            }
            let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: host.staticTexts[expected])
            XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 5), .completed)
        }
        host.terminate()
        XCTAssertEqual(main.state, .notRunning)
    }
    private func retain(_ host: XCUIApplication, state: String) {
        let screenshot = XCTAttachment(screenshot: host.screenshot())
        screenshot.name = "original-source-share-" + state
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: host.debugDescription)
        tree.name = "original-source-share-" + state + "-native-tree"
        tree.lifetime = .keepAlways
        add(tree)
    }
}
