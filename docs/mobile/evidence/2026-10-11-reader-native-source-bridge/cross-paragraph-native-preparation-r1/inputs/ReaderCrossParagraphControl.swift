import XCTest
import UIKit

/** Preparation only: this new source has not been compiled or executed. */
@MainActor final class ReaderCrossParagraphControl: XCTestCase {
    func testNativeEndHandleDragFromGenuineAlphaTowardSecondParagraph() throws {
        continueAfterFailure = false
        let target = XCUIApplication(bundleIdentifier: "app.slax.reader.uifixture")
        XCTAssertEqual(XCUIApplication(bundleIdentifier: "app.slax.reader").state, .notRunning)
        target.activate()
        try foreground(target)
        _ = try back(target)
        // This probe uses only the inspected 402 x 874, English, font-scale-one
        // mixed article. A new native layout needs its own reviewed reference.
        guard close(target.frame.width, 402), close(target.frame.height, 874) else {
            throw failure("Refuse a different viewport")
        }
        // The external executor must bind a completed genuine Alpha press and
        // its current five-character/one-path readonly snapshot before starting
        // this continuation. This test never creates or replaces that selection.
        _ = try selectionBar(target)
        let alpha = try text(target, "Alpha")
        let second = try text(target, "paragraph with quote.")
        guard close(alpha.frame.minX, 20), close(alpha.frame.width, 46), close(alpha.frame.height, 20),
              close(second.frame.minX, 75), close(second.frame.width, 164), close(second.frame.height, 20),
              close(second.frame.minY - alpha.frame.minY, 52),
              alpha.frame.minY > (try back(target)).frame.maxY else {
            throw failure("Native body frames differ from the inspected Alpha/second-paragraph reference")
        }
        try foreground(target)
        let image = target.screenshot()
        retain(target, screenshot: image, name: "cross-paragraph-actual-handles-before-drag")
        // Handles have no distinct AX identifier in the archived native tree.
        // Choose the actual blue ball in this screenshot, rather than assuming
        // an offset from a word or using a synthetic DOM range.
        let handles = try NativeSelectionHandlePixels.inspect(image.image, viewport: target.frame, alpha: alpha.frame)
        let currentSecond = try text(target, "paragraph with quote.")
        guard sameRect(second.frame, currentSecond.frame), sameRect(alpha.frame, (try text(target, "Alpha")).frame) else {
            throw failure("Body geometry changed while identifying actual native handles")
        }
        let destination = CGPoint(x: currentSecond.frame.maxX - 1, y: currentSecond.frame.midY)
        guard target.frame.contains(destination), destination.y > handles.end.y,
              destination.y < target.frame.height - 50 else {
            throw failure("The actual second-paragraph destination is not a visible forward drag")
        }
        retainJSON([
            "version": 1, "preparationOnly": true,
            "nativeGestureVerified": false, "crossParagraphRangeVerified": false,
            "viewport": rect(target.frame), "alpha": rect(alpha.frame), "second": rect(currentSecond.frame),
            "startHandle": point(handles.start), "endHandle": point(handles.end),
            "dragDestination": point(destination), "pixelInspection": handles.records,
            "domRangePrepared": false, "syntheticSelectionPublished": false
        ], name: "cross-paragraph-actual-native-input-geometry")
        let origin = target.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: handles.end.x - target.frame.minX, dy: handles.end.y - target.frame.minY))
        let end = origin.withOffset(CGVector(dx: destination.x - target.frame.minX, dy: destination.y - target.frame.minY))
        XCTContext.runActivity(named: "One native end-handle drag to the inspected second-paragraph text frame") { _ in
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        try foreground(target)
        _ = try back(target)
        _ = try selectionBar(target)
        retain(target, name: "cross-paragraph-after-one-native-handle-drag")
        // A passing XCTest certifies only this one native drag and a retained
        // application menu. The external readonly snapshot validator must still
        // prove a range crossing the actual second-paragraph frame.
    }

    private func text(_ target: XCUIApplication, _ label: String) throws -> XCUIElement {
        let matches = target.staticTexts.matching(NSPredicate(format: "label == %@", label))
            .allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        guard matches.count == 1, let value = matches.first, value.frame.width > 0,
              value.frame.height > 0, target.frame.contains(value.frame) else {
            throw failure("No unique visible inspected article text: \(label)")
        }
        return value
    }
    private func back(_ target: XCUIApplication) throws -> XCUIElement {
        let matches = target.navigationBars.buttons.matching(identifier: "BackButton")
            .allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        guard matches.count == 1, let value = matches.first, value.label == "Library",
              value.frame.maxY < target.frame.height * 0.25 else { throw failure("No unique inspected native Back control") }
        return value
    }
    private func selectionBar(_ target: XCUIApplication) throws -> XCUIElement {
        let query = target.descendants(matching: .any).matching(identifier: "selection_action_bar")
        guard query.firstMatch.waitForExistence(timeout: 5) else { throw failure("The application selection bar was not published") }
        let matches = query.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        guard matches.count == 1, let value = matches.first else { throw failure("No unique hittable selection bar") }
        return value
    }
    private func foreground(_ target: XCUIApplication) throws {
        guard target.wait(for: .runningForeground, timeout: 5), target.alerts.count == 0,
              XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.count == 0,
              XCUIApplication(bundleIdentifier: "app.slax.reader").state == .notRunning else {
            throw failure("Refuse another application or any system/application alert")
        }
    }
    private func retain(_ target: XCUIApplication, screenshot: XCUIScreenshot? = nil, name: String) {
        let frame = XCTAttachment(screenshot: screenshot ?? target.screenshot())
        frame.name = name; frame.lifetime = .keepAlways; add(frame)
        let tree = XCTAttachment(string: target.debugDescription)
        tree.name = name + "-native-tree"; tree.lifetime = .keepAlways; add(tree)
    }
    private func retainJSON(_ value: [String: Any], name: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func failure(_ message: String) -> NSError { NSError(domain: "ControlledCrossParagraphInput", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func close(_ a: CGFloat, _ b: CGFloat) -> Bool { abs(a - b) <= 0.5 }
    private func sameRect(_ a: CGRect, _ b: CGRect) -> Bool { close(a.minX, b.minX) && close(a.minY, b.minY) && close(a.width, b.width) && close(a.height, b.height) }
    private func point(_ value: CGPoint) -> [String: CGFloat] { ["x": value.x, "y": value.y] }
    private func rect(_ value: CGRect) -> [String: CGFloat] { ["x": value.minX, "y": value.minY, "width": value.width, "height": value.height] }
}

/** Pixel inspection is a conservative input guard, not a visual-parity threshold. */
private enum NativeSelectionHandlePixels {
    struct Result { let start: CGPoint; let end: CGPoint; let records: [[String: Any]] }
    static func inspect(_ image: UIImage, viewport: CGRect, alpha: CGRect) throws -> Result {
        func reject() -> NSError { NSError(domain: "ControlledCrossParagraphPixels", code: 1, userInfo: [NSLocalizedDescriptionKey: "No unambiguous inspected pair of native blue selection handles"]) }
        guard let source = image.cgImage, source.width == 1206, source.height == 2622 else { throw reject() }
        let scale: CGFloat = 3
        guard abs(CGFloat(source.width) / viewport.width - scale) < 0.001,
              abs(CGFloat(source.height) / viewport.height - scale) < 0.001 else { throw reject() }
        var bytes = [UInt8](repeating: 0, count: source.width * source.height * 4)
        let components: [[String: Any]] = try bytes.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(data: buffer.baseAddress, width: source.width, height: source.height,
                                          bitsPerComponent: 8, bytesPerRow: source.width * 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue) else { throw reject() }
            context.draw(source, in: CGRect(x: 0, y: 0, width: CGFloat(source.width), height: CGFloat(source.height)))
            let rgba = buffer.bindMemory(to: UInt8.self)
            let crop = CGRect(x: alpha.minX - viewport.minX - 20, y: alpha.minY - viewport.minY - 24,
                              width: alpha.width + 40, height: alpha.height + 48).intersection(CGRect(origin: .zero, size: viewport.size))
            var pixels = Set<Int>()
            for y in Int(floor(crop.minY * scale))..<Int(ceil(crop.maxY * scale)) {
                for x in Int(floor(crop.minX * scale))..<Int(ceil(crop.maxX * scale)) {
                    let index = (y * source.width + x) * 4
                    // Archived native solid paint is RGBA(20,111,225,255).
                    // This band covers its edge paint; no broad screen search.
                    if rgba[index] < 55 && rgba[index + 1] > 75 && rgba[index + 1] < 155 && rgba[index + 2] > 180 && rgba[index + 3] == 255 {
                        pixels.insert(y * source.width + x)
                    }
                }
            }
            var result = [[String: Any]]()
            while let first = pixels.first {
                pixels.remove(first)
                var queue = [first], cursor = 0, rows = [Int: [Int]]()
                while cursor < queue.count {
                    let current = queue[cursor]; cursor += 1
                    let x = current % source.width, y = current / source.width
                    rows[y, default: []].append(x)
                    for next in [current - 1, current + 1, current - source.width, current + source.width] {
                        // The crop never crosses a row edge; every neighbour
                        // must already be in the bounded blue-pixel set.
                        if pixels.remove(next) != nil { queue.append(next) }
                    }
                }
                guard queue.count >= 180 * 9 else { throw reject() }
                let spans = rows.map { (y: $0.key, left: $0.value.min()!, right: $0.value.max()!) }
                let widest = spans.map { $0.right - $0.left + 1 }.max()!
                guard (42...54).contains(widest), (95...115).contains(rows.count) else { throw reject() }
                let ballRows = spans.filter { $0.right - $0.left + 1 == widest }
                let x = ballRows.map { CGFloat($0.left + $0.right + 1) / 2 }.reduce(0, +) / CGFloat(ballRows.count)
                let y = ballRows.map { CGFloat($0.y) + 0.5 }.reduce(0, +) / CGFloat(ballRows.count)
                result.append(["pixels": queue.count, "widestRowPixels": widest,
                               "pixelX": x, "pixelY": y,
                               "screenX": viewport.minX + x / scale, "screenY": viewport.minY + y / scale])
            }
            return result
        }
        guard components.count == 2 else { throw reject() }
        let points = components.map { CGPoint(x: $0["screenX"] as! CGFloat, y: $0["screenY"] as! CGFloat) }
        guard let start = points.first(where: { $0.y < alpha.minY }),
              let end = points.first(where: { $0.y > alpha.maxY }),
              abs(start.x - alpha.minX) <= 2,
              end.x > alpha.midX, end.x <= alpha.maxX + 2,
              end.y - alpha.maxY <= 18, alpha.minY - start.y <= 18 else { throw reject() }
        return Result(start: start, end: end, records: components)
    }
}
