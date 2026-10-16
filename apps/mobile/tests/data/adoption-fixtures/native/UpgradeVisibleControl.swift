import XCTest

/// Activates only an already running, separately guarded full-row upgrade fixture.
@MainActor final class UpgradeVisibleControl: XCTestCase {
    private let expectedDevice = "@@DEVICE@@"
    private let expectedNonce = "@@NONCE@@"
    private let expectedRun = "@@RUN_ID@@"

    private func main() throws -> XCUIApplication {
        continueAfterFailure = false
        XCTAssertEqual(ProcessInfo.processInfo.environment["SIMULATOR_UDID"], expectedDevice)
        XCTAssertFalse(expectedNonce.isEmpty)
        XCTAssertFalse(expectedRun.isEmpty)
        let app = XCUIApplication(bundleIdentifier: "app.slax.reader")
        XCTAssertNotEqual(app.state, .notRunning, "The guarded normal runtime must already be running; this host never launches or initializes it")
        app.activate()
        return app
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "source-valid-upgrade-" + name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "source-valid-upgrade-" + name + "-native-tree"
        tree.lifetime = .keepAlways
        add(tree)
    }

    private func assertOriginalCommentPanel(_ app: XCUIApplication) {
        let panels = app.otherElements.matching(identifier: "reader-comment-panel")
        XCTAssertTrue(panels.firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(panels.count, 1, app.debugDescription)
        let comments = panels.firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Pending comment"))
        // Actual rich-text content is one accessible Other, rather than a StaticText.
        XCTAssertEqual(comments.count, 1, app.debugDescription)
        XCTAssertTrue(comments.firstMatch.isHittable, app.debugDescription)
    }

    func testInspectLibrary() throws {
        let app = try main()
        capture(app, "initial-library-inspection")
        // Inspection records the actual tree; it does not assert visible acceptance.
    }

    func testDismissObservedDevelopmentOnboarding() throws {
        let app = try main()
        XCTAssertEqual(app.alerts.count, 0)
        XCTAssertTrue(app.staticTexts["This is the developer menu. It gives you access to useful tools in development builds."].firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        let proceed = app.buttons["Continue"].firstMatch
        XCTAssertTrue(proceed.exists && proceed.isHittable)
        capture(app, "observed-development-onboarding")
        proceed.tap()
        let close = app.buttons["xmark"].firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 5) && close.isHittable, app.debugDescription)
        close.tap()
        let bookmark = app.buttons["Controlled actual service offline edit"].firstMatch
        XCTAssertTrue(bookmark.waitForExistence(timeout: 5) && bookmark.isHittable, app.debugDescription)
        capture(app, "library-after-development-onboarding")
    }

    func testInspectLoadedReader() throws {
        let app = try main()
        XCTAssertTrue(app.otherElements["reader-screen"].firstMatch.exists)
        capture(app, "loaded-reader-inspection")
    }

    func testDismissObservedControlledOfflineLogBox() throws {
        let app = try main()
        let query = app.otherElements.matching(NSPredicate(format: "label == %@", "!, [PowerSync]: Sync error ApiError: Controlled offline transport refuses forwarding"))
        XCTAssertEqual(query.count, 1, app.debugDescription)
        let toast = query.firstMatch
        XCTAssertTrue(toast.isHittable)
        XCTAssertGreaterThan(toast.frame.width, 300)
        XCTAssertLessThan(toast.frame.height, 60)
        capture(app, "observed-controlled-offline-logbox")
        // The inspected LogBox close glyph is at the trailing end of this exact toast.
        toast.coordinate(withNormalizedOffset: CGVector(dx: 0.945, dy: 0.5)).tap()
        XCTAssertFalse(toast.waitForExistence(timeout: 1))
        capture(app, "reader-after-controlled-offline-logbox")
    }

    func testNativeBackFromLoadedReader() throws {
        let app = try main()
        XCTAssertTrue(app.otherElements["reader-screen"].firstMatch.exists)
        let back = app.navigationBars.buttons["BackButton"].firstMatch
        XCTAssertTrue(back.exists && back.isHittable, app.debugDescription)
        capture(app, "loaded-reader-before-native-back")
        back.tap()
        let bookmark = app.buttons["Controlled actual service offline edit"].firstMatch
        XCTAssertTrue(bookmark.waitForExistence(timeout: 10) && bookmark.isHittable)
        capture(app, "library-after-native-back")
    }

    func testOpenOriginalOfflineComment() throws {
        let app = try main()
        XCTAssertEqual(app.alerts.count, 0)
        XCTAssertTrue(app.otherElements["reader-screen"].firstMatch.exists)
        let markedQuote = app.webViews.staticTexts["Controlled offline fixture"].firstMatch
        XCTAssertTrue(markedQuote.waitForExistence(timeout: 5) && markedQuote.isHittable, app.debugDescription)
        capture(app, "original-offline-mark-before-tap")
        markedQuote.tap()
        assertOriginalCommentPanel(app)
        capture(app, "original-offline-comment-open")
    }

    func testOpenOriginalOfflineCommentAtObservedUnderline() throws {
        let app = try main()
        XCTAssertEqual(app.alerts.count, 0)
        let bookmark = app.buttons["Controlled actual service offline edit"].firstMatch
        XCTAssertTrue(bookmark.exists && bookmark.isHittable)
        bookmark.tap()
        let markedQuote = app.webViews.staticTexts["Controlled offline fixture"].firstMatch
        XCTAssertTrue(markedQuote.waitForExistence(timeout: 15) && markedQuote.isHittable, app.debugDescription)
        XCTAssertTrue(app.webViews.staticTexts["Preserved offline reading"].firstMatch.exists)
        let frame = markedQuote.frame
        XCTAssertGreaterThan(frame.minY, 116)
        XCTAssertLessThan(frame.maxY, 700)
        let point = CGPoint(x: frame.midX, y: frame.maxY - 1)
        let coordinates = XCTAttachment(string: "Observed quote frame=\(frame); underline native point=\(point)")
        coordinates.name = "source-valid-upgrade-observed-underline-hit-coordinate"
        coordinates.lifetime = .keepAlways
        add(coordinates)
        capture(app, "original-offline-underline-before-coordinate-tap")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: point.x, dy: point.y)).tap()
        assertOriginalCommentPanel(app)
        capture(app, "original-offline-comment-after-underline-tap")
    }

    func testScrollToOriginalQuoteAndOpenComment() throws {
        let app = try main()
        XCTAssertEqual(app.alerts.count, 0)
        XCTAssertTrue(app.otherElements["reader-screen"].firstMatch.exists)
        let quote = app.webViews.staticTexts["Controlled offline fixture"].firstMatch
        XCTAssertTrue(quote.exists)
        capture(app, "reader-before-actual-native-downward-gesture")
        app.webViews.firstMatch.swipeDown()
        let moved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in quote.exists && quote.frame.minY >= 298 && quote.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [moved], timeout: 10), .completed, app.debugDescription)
        let coordinates = XCTAttachment(string: "Actual gesture relocated original quote to \(quote.frame)")
        coordinates.name = "source-valid-upgrade-quote-after-real-gesture"
        coordinates.lifetime = .keepAlways
        add(coordinates)
        capture(app, "original-quote-after-actual-native-downward-gesture")
        quote.tap()
        assertOriginalCommentPanel(app)
        capture(app, "original-offline-comment-after-real-gesture")
    }

    func testOpenOriginalReaderAndNativeBack() throws {
        let app = try main()
        XCTAssertEqual(app.alerts.count, 0, "An unexpected system alert must be inspected before an action")
        let bookmark = app.buttons["Controlled actual service offline edit"].firstMatch
        XCTAssertTrue(bookmark.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(bookmark.isHittable)
        capture(app, "library-original-row")
        bookmark.tap()
        XCTAssertTrue(app.otherElements["reader-screen"].firstMatch.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15), app.debugDescription)
        capture(app, "reader-original-cache")
        let back = app.navigationBars.buttons["BackButton"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(back.isHittable)
        back.tap()
        XCTAssertTrue(bookmark.waitForExistence(timeout: 10))
        XCTAssertTrue(bookmark.isHittable)
        capture(app, "library-after-native-back")
    }
}
