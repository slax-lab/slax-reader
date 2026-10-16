import XCTest

/** One genuine coordinate drag per externally measured, nonce-bound source request. */
@MainActor final class SourceFixtureNativeScrollControl: XCTestCase {
    func testPerformOneMeasuredOriginalReaderNativeDrag() throws {
        continueAfterFailure = false
        guard let encoded = ProcessInfo.processInfo.environment["SLAX_SOURCE_NATIVE_SCROLL_REQUEST"],
              let data = encoded.data(using: .utf8), data.count <= 16 * 1024,
              let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              request["kind"] as? String == "original-source-native-scroll-request",
              request["fixtureVersion"] as? Int == 1,
              let nonce = request["observationNonce"] as? String, UUID(uuidString: nonce) != nil,
              request["fixtureInputSha256"] as? String == "aaf4fdd7fd8b205ed6f2e297686f20bb3f523b680d35fc62effcdc8a2a4afe2f",
              request["sourceManifestSha256"] as? String == "3501089ae75682a823afdfb54ccf243d32cbc56eba1f84bd70c68afafc1f2943",
              let gestureIndex = request["gestureIndex"] as? Int, (1...3).contains(gestureIndex),
              let observedAt = request["observedAtUnixSeconds"] as? Double,
              observedAt.isFinite, (0...30).contains(Date().timeIntervalSince1970 - observedAt),
              let geometry = request["beforeGeometry"] as? [String: Any],
              geometry["windowAttached"] as? Bool == true, geometry["loading"] as? Bool == false,
              geometry["dragging"] as? Bool == false, geometry["decelerating"] as? Bool == false,
              request["bodyAndBridgeReady"] as? Bool == true,
              let frame = geometry["frameInWindow"] as? [String: Any],
              let start = request["startPoints"] as? [String: Any],
              let end = request["endPoints"] as? [String: Any] else {
            throw rejected("Missing, stale or unbound native scroll request")
        }
        func number(_ values: [String: Any], _ key: String) throws -> Double {
            guard let result = (values[key] as? NSNumber)?.doubleValue, result.isFinite else {throw rejected("Missing finite coordinate")}
            return result
        }
        let x = try number(start, "x"), y = try number(start, "y")
        let endX = try number(end, "x"), endY = try number(end, "y")
        let width = try number(frame, "width"), height = try number(frame, "height")
        let beforeY = try number(geometry, "offsetYPoints")
        let source = XCUIApplication(bundleIdentifier: "app.slax.reader.sourcefixture")
        XCTAssertEqual(XCUIApplication(bundleIdentifier: "app.slax.reader").state, .notRunning)
        source.activate()
        XCTAssertTrue(source.wait(for: .runningForeground, timeout: 5))
        XCTAssertEqual(source.alerts.count, 0, "No automatic dialog handling in a measured input run")
        XCTAssertEqual(XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.count, 0)
        XCTAssertEqual(Double(source.frame.width), width)
        XCTAssertEqual(Double(source.frame.height), height)
        XCTAssertEqual(try number(frame, "x"), 0)
        XCTAssertEqual(try number(frame, "y"), 0)
        XCTAssertEqual(width, 402); XCTAssertEqual(height, 874)
        XCTAssertEqual(try number(geometry, "viewportWidthPoints"), width)
        XCTAssertEqual(try number(geometry, "viewportHeightPoints"), height)
        XCTAssertEqual(try number(geometry, "contentWidthPoints"), width)
        XCTAssertTrue(source.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "A fixed title with English")).firstMatch.waitForExistence(timeout: 5))
        guard x == endX, x >= width * 0.7, x <= width - 24,
              y >= max(0, -beforeY) + 40, endY >= max(0, -beforeY) + 40,
              y <= height - 120, endY <= height - 120,
              abs(y - endY) > 0, abs(y - endY) <= 120 else {
            throw rejected("Drag endpoints are outside the measured original body")
        }
        retain(source, name: "source-native-drag-before-\(gestureIndex)")
        let requestAttachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        requestAttachment.name = "source-native-drag-measured-request-\(gestureIndex)"
        requestAttachment.lifetime = .keepAlways
        add(requestAttachment)
        let origin = source.coordinate(withNormalizedOffset: .zero)
        let from = origin.withOffset(CGVector(dx: CGFloat(x), dy: CGFloat(y)))
        let to = origin.withOffset(CGVector(dx: CGFloat(endX), dy: CGFloat(endY)))
        XCTContext.runActivity(named: "Genuine original WK body drag \(gestureIndex); nonce \(nonce)") { _ in
            from.press(forDuration: 0.1, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
        }
        XCTAssertTrue(source.wait(for: .runningForeground, timeout: 3))
        XCTAssertEqual(source.alerts.count, 0)
        XCTAssertEqual(XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.count, 0)
        XCTAssertEqual(XCUIApplication(bundleIdentifier: "app.slax.reader").state, .notRunning)
        retain(source, name: "source-native-drag-after-\(gestureIndex)-position-not-assumed")
        // Position acceptance belongs to the subsequent actual native KVO/sampler
        // artifact. Completion of this XCTest gesture alone cannot prove240.
    }
    private func rejected(_ reason: String) -> NSError {
        NSError(domain: "ControlledOriginalReaderInput", code: 1,
                userInfo: [NSLocalizedDescriptionKey: reason])
    }
    private func retain(_ source: XCUIApplication, name: String) {
        let frame = XCTAttachment(screenshot: source.screenshot()); frame.name = name; frame.lifetime = .keepAlways; add(frame)
        let tree = XCTAttachment(string: source.debugDescription); tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    }
}
