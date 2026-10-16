import XCTest
import UIKit

/** Each case requires a fresh synthetic scope in the independently prepared UI fixture. */
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
        try scrollDocument(target)
        try backgroundAndResume(target, name: "reader")
        XCTAssertTrue(try nativeBack(target).isHittable)
        _ = try unique(target.descendants(matching: .any).matching(identifier: "reader-document"), in: target, name: "resumed-reader-document", hittable: false)
        retain(target, name: "reader-after-native-scroll-background")
    }
    func testNativeLibraryBackgroundAndResume() throws {
        let target = try preparedLibrary()
        _ = try libraryRow(target, title: mixedTitle)
        try backgroundAndResume(target, name: "library")
        try requireLibrary(target)
        _ = try libraryRow(target, title: mixedTitle)
        retain(target, name: "library-after-background")
    }
    func testNativeLibraryVerticalDrag() throws {
        let target = try preparedLibrary()
        try verticalLibraryDrag(target)
    }
    func testNativeLibraryRowSwipeReverseInterruptedThenVertical() throws {
        let target = try preparedLibrary()
        let row = try libraryRow(target, title: mixedTitle)
        let closed = row.frame
        retain(target, name: "library-before-row-swipe")
        try drag(target, within: closed, from: CGVector(dx: 0.8, dy: 0.5), to: CGVector(dx: 0.2, dy: 0.5))
        try waitUntil(target, name: "row-opened") { row.frame.minX < closed.minX - closed.width * 0.05 }
        retain(target, name: "library-row-swipe-open")
        let opened = row.frame.intersection(target.frame)
        try drag(target, within: opened, from: CGVector(dx: 0.2, dy: 0.5), to: CGVector(dx: 0.9, dy: 0.5))
        try waitUntil(target, name: "row-reversed") { abs(row.frame.minX - closed.minX) <= 1 }
        retain(target, name: "library-row-swipe-reversed")
        try backgroundAndResume(target, name: "library-row-interrupted", beforeHome: {
            try self.drag(target, within: row.frame.intersection(target.frame), from: CGVector(dx: 0.8, dy: 0.5), to: CGVector(dx: 0.6, dy: 0.5))
        })
        try requireLibrary(target)
        let resumedRow = try libraryRow(target, title: mixedTitle)
        if resumedRow.frame.minX < closed.minX - 1 {
            try drag(target, within: resumedRow.frame.intersection(target.frame), from: CGVector(dx: 0.15, dy: 0.5), to: CGVector(dx: 0.9, dy: 0.5))
        }
        try waitUntil(target, name: "interrupted-row-reversed") { abs(row.frame.minX - closed.minX) <= 1 }
        try verticalLibraryDrag(target)
    }
    func testNativeCachedArticleRoundTrips() throws {
        let target = try preparedReader()
        _ = try alpha(target)
        try nativeBack(target).tap()
        try requireLibrary(target)
        var timings: [[String: Any]] = []
        defer { retainJSON(["requestedRoundTrips": 3, "completedRoundTrips": timings.count, "samples": timings,
                            "metric": "XCTest tap-to-visible-body and Back-to-Library wall time; includes automation overhead, not FPS"], name: "cached-navigation-timings") }
        for index in 1...3 {
            let row = try libraryRow(target, title: mixedTitle)
            let start = ProcessInfo.processInfo.systemUptime
            row.tap()
            _ = try nativeBack(target)
            _ = try alpha(target)
            let opened = ProcessInfo.processInfo.systemUptime
            retain(target, name: "cached-navigation-\(index)-reader")
            let backStart = ProcessInfo.processInfo.systemUptime
            try nativeBack(target).tap()
            try requireLibrary(target)
            let returned = ProcessInfo.processInfo.systemUptime
            timings.append(["iteration": index, "openSeconds": opened - start, "backSeconds": returned - backStart])
            retain(target, name: "cached-navigation-\(index)-library")
        }
    }
    func testNativeAlphaHighlightMenuState() throws {
        let target = try preparedReader()
        let menu = try longPressAlpha(target)
        try unique(menu.buttons.matching(NSPredicate(format: "label == %@", "Highlight")), in: target, name: "source-highlight").tap()
        try requireSelectionMenuGone(target)
        try requireNoSystemEditMenu(target, name: "after-highlight")
        let highlighted = try longPressAlpha(target)
        _ = try unique(highlighted.buttons.matching(NSPredicate(format: "label == %@", "Remove")), in: target, name: "source-remove-highlight")
        retain(target, name: "alpha-highlight-confirmed")
    }
    func testNativeAlphaCommentEditorCopyPaste() throws {
        let target = try preparedReader()
        let menu = try longPressAlpha(target)
        try unique(menu.buttons.matching(NSPredicate(format: "label == %@", "Comment")), in: target, name: "source-comment").tap()
        try requireSelectionMenuGone(target)
        let panel = try unique(target.descendants(matching: .any).matching(identifier: "reader-comment-panel"), in: target, name: "comment-panel")
        let quote = try unique(panel.descendants(matching: .any).matching(identifier: "reader-comment-quote"), in: target, name: "comment-quote", hittable: false)
        XCTAssertEqual(quote.label.trimmingCharacters(in: .whitespacesAndNewlines), "Alpha")
        try requireNoSystemEditMenu(target, name: "after-comment-open")
        let editor = try unique(target.textViews.matching(identifier: "reader-comment-input"), in: target, name: "comment-editor")
        let token = "SlaxNativeCopyProbe"
        editor.tap()
        editor.typeText(token)
        try waitUntil(target, name: "editor-typed-token") { editor.value as? String == token }
        editor.doubleTap()
        let copy = try systemEditAction(target, labels: ["Copy", "复制", "拷贝"], name: "editor-system-copy")
        retain(target, name: "comment-editor-system-copy-visible")
        copy.tap()
        editor.typeText(XCUIKeyboardKey.delete.rawValue)
        try waitUntil(target, name: "editor-selection-deleted") {
            let value = editor.value as? String ?? ""
            return value.isEmpty || value == editor.placeholderValue
        }
        editor.press(forDuration: 1)
        let paste = try systemEditAction(target, labels: ["Paste", "粘贴"], name: "editor-system-paste")
        retain(target, name: "comment-editor-system-paste-visible")
        paste.tap()
        try waitUntil(target, name: "editor-native-paste-restored-token") { editor.value as? String == token }
        retain(target, name: "comment-editor-after-native-copy-paste")
        let send = try unique(target.buttons.matching(identifier: "reader-comment-send"), in: target, name: "comment-send")
        XCTAssertTrue(send.isEnabled)
        send.tap()
        try waitUntil(target, name: "comment-submitted") {
            let rows = target.buttons.matching(NSPredicate(format: "identifier MATCHES %@", "reader-comment--?[0-9]+"))
                .allElementsBoundByIndex.filter { $0.exists && ($0.label.contains(token) || $0.staticTexts.matching(NSPredicate(format: "label == %@", token)).count > 0) }
            return rows.count == 1
        }
        try requireSelectionMenuGone(target)
        try requireNoSystemEditMenu(target, name: "after-comment-submit")
        retain(target, name: "alpha-comment-submitted")
        try requireOwnForeground(target)
    }
    func testNativeScrollThenHeaderBack() throws {
        let target = try preparedReader()
        retain(target, name: "reader-before-native-scroll-exit")
        try scrollDocument(target)
        try nativeBack(target).tap()
        try requireLibrary(target)
        retain(target, name: "reader-after-native-scroll-exit")
    }
    func testNativeBackClearsPreparedSelection() throws {
        let target = try preparedReader()
        let selection = try observedSelectionBar(target)
        retain(target, name: "reader-before-native-selection-dismissal")
        try nativeBack(target).tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: selection)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 5), .completed)
        XCTAssertTrue(try nativeBack(target).isHittable, "Selection dismissal must retain Reader rather than also pop the route")
        try requireOwnForeground(target)
        retain(target, name: "reader-after-native-selection-dismissal")
    }
    func testNativeLongPressOriginalBodyWord() throws {
        let target = try preparedReader()
        _ = try longPressAlpha(target)
    }
    private let mixedTitle = "A fixed title with English and 中文 for line wrapping, images, tables, formulas, comments and highlights"
    private let customMenuIDs = ["selection_action_bar", "reader-comment-menu"]

    private func alpha(_ target: XCUIApplication) throws -> XCUIElement {
        let document = try unique(target.descendants(matching: .any).matching(identifier: "reader-document"), in: target, name: "reader-document", hittable: false)
        let word = try unique(document.staticTexts.matching(NSPredicate(format: "label == %@", "Alpha")), in: target, name: "native-alpha")
        guard target.frame.contains(word.frame), word.frame.minY > (try nativeBack(target)).frame.maxY else {
            throw rejected(target, "Alpha is not fully below the inspected native header")
        }
        return word
    }
    private func longPressAlpha(_ target: XCUIApplication) throws -> XCUIElement {
        try requireSelectionMenuGone(target)
        let word = try alpha(target)
        retain(target, name: "reader-before-native-word-long-press")
        word.press(forDuration: 1)
        retain(target, name: "reader-after-native-word-long-press")
        let menu = try observedSelectionBar(target)
        _ = try unique(menu.buttons.matching(NSPredicate(format: "label == %@", "Copy")), in: target, name: "source-copy")
        _ = try unique(menu.buttons.matching(NSPredicate(format: "label == %@", "Comment")), in: target, name: "source-comment")
        try requireNoSystemEditMenu(target, name: "alpha-selected")
        retain(target, name: "reader-native-word-selection-published")
        try requireOwnForeground(target)
        return menu
    }
    private func observedSelectionBar(_ target: XCUIApplication) throws -> XCUIElement {
        try unique(target.descendants(matching: .any).matching(identifier: "selection_action_bar"), in: target, name: "source-selection-bar")
    }
    private func requireSelectionMenuGone(_ target: XCUIApplication) throws {
        try waitUntil(target, name: "selection-bar-dismissed") {
            target.descendants(matching: .any).matching(identifier: "selection_action_bar").count == 0
        }
    }
    private func editControls(_ root: XCUIElement, labels: [String]) -> [XCUIElement] {
        root.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", labels))
            .allElementsBoundByIndex.filter { ($0.elementType == .button || $0.elementType == .menuItem) && $0.exists }
    }
    private struct MenuSnapshotNode {
        let type: XCUIElement.ElementType
        let identifier: String
        let label: String
        let frame: CGRect
        let parent: Int?
    }
    private func menuSnapshotNodes(_ root: XCUIElementSnapshot) -> [MenuSnapshotNode] {
        var nodes: [MenuSnapshotNode] = []
        func append(_ snapshot: XCUIElementSnapshot, parent: Int?) {
            let index = nodes.count
            nodes.append(MenuSnapshotNode(type: snapshot.elementType, identifier: snapshot.identifier,
                                          label: snapshot.label, frame: snapshot.frame, parent: parent))
            for child in snapshot.children { append(child, parent: index) }
        }
        append(root, parent: nil)
        return nodes
    }
    private func editMenuViolation(_ nodes: [MenuSnapshotNode], application: Bool) -> String? {
        let labels: Set<String> = ["Copy", "Cut", "Paste", "Select", "Select All", "复制", "拷贝", "剪切", "粘贴", "选择", "全选"]
        guard nodes.first?.type == .application, nodes.contains(where: { $0.type == .window }) else {
            return "Incomplete application accessibility snapshot"
        }
        if nodes.contains(where: { $0.type == .menu || $0.type == .menuItem }) {
            return "Native Menu/MenuItem exists; do not dismiss or hide it"
        }
        func descends(_ index: Int, from ancestor: Int) -> Bool {
            var parent = nodes[index].parent
            while let current = parent {
                if current == ancestor { return true }
                parent = nodes[current].parent
            }
            return false
        }
        func containsFrame(_ outer: CGRect, _ inner: CGRect) -> Bool {
            !outer.isNull && !outer.isInfinite && !outer.isEmpty &&
                !inner.isNull && !inner.isInfinite && !inner.isEmpty && outer.contains(inner)
        }
        var allowedButtons = Set<Int>()
        if application {
            for identifier in customMenuIDs {
                let roots = nodes.indices.filter { nodes[$0].identifier == identifier }
                guard roots.count <= 1 else { return "Ambiguous application menu identifier: \(identifier)" }
                if let root = roots.first {
                    let copies = nodes.indices.filter { descends($0, from: root) && nodes[$0].type == .button && nodes[$0].label == "Copy" }
                    guard copies.count == 1, let copy = copies.first, containsFrame(nodes[root].frame, nodes[copy].frame) else {
                        return "Application menu has no unique, contained English Copy button: \(identifier)"
                    }
                    allowedButtons.insert(copy)
                }
            }
            let panelCopies = nodes.indices.filter { nodes[$0].type == .button && nodes[$0].label == "Copy highlighted text" }
            let panels = nodes.indices.filter { nodes[$0].identifier == "reader-comment-panel" }
            guard panelCopies.count <= 1, panels.count <= 1 else { return "Ambiguous comment-panel Copy control" }
            if let copy = panelCopies.first {
                guard let panel = panels.first, descends(copy, from: panel), containsFrame(nodes[panel].frame, nodes[copy].frame) else {
                    return "Copy highlighted text is outside its identified application panel"
                }
                allowedButtons.insert(copy)
            }
        }
        for index in nodes.indices where labels.contains(nodes[index].label) {
            if allowedButtons.contains(index) { continue }
            if nodes[index].type == .staticText && nodes[index].label == "Copy" && allowedButtons.contains(where: {
                descends(index, from: $0) && containsFrame(nodes[$0].frame, nodes[index].frame)
            }) { continue }
            return "Unclassified edit control/label: \(nodes[index].type.rawValue) \(nodes[index].identifier) \(nodes[index].label)"
        }
        return nil
    }
    private func requireNoSystemEditMenu(_ target: XCUIApplication, name: String) throws {
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let started = ProcessInfo.processInfo.systemUptime
        let budget: TimeInterval = 15
        var firstCleanCapture: TimeInterval?
        var cleanSnapshots = 0
        var observations: [[String: Any]] = []
        var violation: String?
        var complete = false
        func capture(_ app: XCUIApplication, application: Bool, label: String) throws -> TimeInterval {
            let captureStarted = ProcessInfo.processInfo.systemUptime
            let snapshot = try app.snapshot()
            let captured = ProcessInfo.processInfo.systemUptime
            let nodes = menuSnapshotNodes(snapshot)
            violation = editMenuViolation(nodes, application: application)
            observations.append(["application": label, "startedSeconds": captureStarted - started,
                                 "capturedSeconds": captured - started, "captureSeconds": captured - captureStarted,
                                 "nodeCount": nodes.count, "violation": violation ?? "none",
                                 "nodes": nodes.enumerated().map { index, node in
                                     ["index": index, "parent": node.parent.map { $0 as Any } ?? NSNull(),
                                      "type": node.type.rawValue, "identifier": node.identifier, "label": node.label,
                                      "frame": NSCoder.string(for: node.frame)] as [String: Any]
                                 }])
            return captured
        }
        let observation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard ProcessInfo.processInfo.systemUptime - started < budget else { return true }
            do {
                let appCaptured = try capture(target, application: true, label: "fixture")
                if violation != nil || ProcessInfo.processInfo.systemUptime - started >= budget { return true }
                let systemCaptured = try capture(system, application: false, label: "springboard")
                if violation != nil || ProcessInfo.processInfo.systemUptime - started >= budget { return true }
                cleanSnapshots += 1
                if let firstCleanCapture {
                    complete = cleanSnapshots >= 2 && appCaptured - firstCleanCapture >= 2
                } else {
                    firstCleanCapture = systemCaptured
                }
                return complete
            } catch {
                violation = "Native accessibility snapshot failed: \(error)"
                return true
            }
        }, object: nil)
        let result = XCTWaiter.wait(for: [observation], timeout: budget)
        let elapsed = ProcessInfo.processInfo.systemUptime - started
        retainJSON(["budgetSeconds": budget, "elapsedSeconds": elapsed, "cleanSnapshotPairs": cleanSnapshots,
                    "minimumCleanSpanSeconds": 2, "complete": complete, "violation": violation ?? "none",
                    "observations": observations], name: name + "-edit-menu-observations")
        retain(target, name: name + "-edit-menu-check")
        retain(system, name: name + "-system-menu-check")
        guard result == .completed, complete, violation == nil, elapsed <= budget else {
            throw rejected(target, violation ?? "Did not capture multiple clean app/system snapshots spanning two seconds within the measured 15-second budget")
        }
    }
    private func systemEditAction(_ target: XCUIApplication, labels: [String], name: String) throws -> XCUIElement {
        var found: [XCUIElement] = []
        try waitUntil(target, name: name) {
            let custom = self.customMenuIDs.flatMap { target.descendants(matching: .any).matching(identifier: $0).allElementsBoundByIndex }
            if custom.contains(where: { !self.editControls($0, labels: labels).isEmpty }) { return false }
            found = self.editControls(target, labels: labels) + self.editControls(XCUIApplication(bundleIdentifier: "com.apple.springboard"), labels: labels)
            return found.count == 1 && found[0].isHittable && found[0].isEnabled
        }
        guard found.count == 1 else { throw rejected(target, "Cannot distinguish one enabled system edit action from application labels") }
        return found[0]
    }
    private func preparedReader() throws -> XCUIApplication {
        let target = try preparedTarget()
        _ = try nativeBack(target)
        return target
    }
    private func preparedLibrary() throws -> XCUIApplication {
        let target = try preparedTarget()
        try requireLibrary(target)
        return target
    }
    private func preparedTarget() throws -> XCUIApplication {
        continueAfterFailure = false
        XCTAssertEqual(XCUIApplication(bundleIdentifier: "app.slax.reader").state, .notRunning, "Do not activate the production main application")
        let target = XCUIApplication(bundleIdentifier: "app.slax.reader.uifixture")
        guard [.runningForeground, .runningBackground, .runningBackgroundSuspended].contains(target.state) else {
            throw rejected(target, "Prepare the isolated synthetic fixture first; do not implicitly launch it")
        }
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
        return target
    }
    private func libraryRow(_ target: XCUIApplication, title: String) throws -> XCUIElement {
        try unique(target.buttons.matching(NSPredicate(format: "label == %@", title)), in: target, name: "library-row")
    }
    private func verticalLibraryDrag(_ target: XCUIApplication) throws {
        try requireLibrary(target)
        let list = try unique(target.scrollViews.containing(.button, identifier: mixedTitle), in: target, name: "library-scroll-container", hittable: false)
        let anchor = try libraryRow(target, title: "Long article for scroll restoration")
        let before = anchor.frame
        retain(target, name: "library-before-vertical-drag")
        try drag(target, within: list.frame.intersection(target.frame), from: CGVector(dx: 0.5, dy: 0.8), to: CGVector(dx: 0.5, dy: 0.3))
        var changedAt: TimeInterval?
        try waitUntil(target, name: "library-content-moved-not-bounced") {
            let moved = anchor.exists && anchor.frame.minY < before.minY - before.height * 0.25
            if !moved { changedAt = nil; return false }
            let now = ProcessInfo.processInfo.systemUptime
            if changedAt == nil { changedAt = now }
            return now - (changedAt ?? now) >= 1
        }
        retainJSON(["anchor": anchor.label, "before": NSCoder.string(for: before), "after": NSCoder.string(for: anchor.frame)], name: "library-vertical-displacement")
        try requireLibrary(target)
        retain(target, name: "library-after-vertical-drag")
    }
    private func scrollDocument(_ target: XCUIApplication) throws {
        let document = try unique(target.descendants(matching: .any).matching(identifier: "reader-document"), in: target, name: "scroll-reader-document", hittable: false)
        let anchor = try alpha(target)
        let before = anchor.frame
        let back = try nativeBack(target)
        let visible = document.frame.intersection(target.frame)
        let body = CGRect(x: visible.minX, y: max(visible.minY, back.frame.maxY), width: visible.width,
                          height: visible.maxY - max(visible.minY, back.frame.maxY))
        try drag(target, within: body, from: CGVector(dx: 0.55, dy: 0.78), to: CGVector(dx: 0.55, dy: 0.34))
        try waitUntil(target, name: "reader-body-scrolled") { anchor.exists && anchor.frame.minY < before.minY - before.height }
        retainJSON(["anchor": "Alpha", "before": NSCoder.string(for: before), "after": NSCoder.string(for: anchor.frame)], name: "reader-scroll-displacement")
    }
    private func drag(_ target: XCUIApplication, within frame: CGRect, from: CGVector, to: CGVector) throws {
        guard !frame.isNull, !frame.isInfinite, frame.width > 0, frame.height > 0, target.frame.contains(frame) else {
            throw rejected(target, "No usable observed frame for native drag")
        }
        let origin = target.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: frame.minX - target.frame.minX + frame.width * from.dx,
                                              dy: frame.minY - target.frame.minY + frame.height * from.dy))
        let end = origin.withOffset(CGVector(dx: frame.minX - target.frame.minX + frame.width * to.dx,
                                            dy: frame.minY - target.frame.minY + frame.height * to.dy))
        retainJSON(["frame": NSCoder.string(for: frame), "start": NSCoder.string(for: start.screenPoint), "end": NSCoder.string(for: end.screenPoint)], name: "native-drag-geometry")
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
    }
    private func backgroundAndResume(_ target: XCUIApplication, name: String, beforeHome: () throws -> Void = {}) throws {
        try requireOwnForeground(target)
        retain(target, name: name + "-before-background")
        let beforePID = observedPID(target)
        try beforeHome()
        let start = ProcessInfo.processInfo.systemUptime
        var observations: [[String: Any]] = []
        var sawBackground = false
        var sawSuspension = false
        var failure: String?
        defer { retainJSON(["observations": observations, "sawBackground": sawBackground, "sawSuspension": sawSuspension,
                            "suspensionRequired": false, "failure": failure ?? "none"], name: name + "-background-states") }
        XCUIDevice.shared.press(.home)
        let observation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let elapsed = ProcessInfo.processInfo.systemUptime - start
            let state = target.state
            observations.append(["seconds": elapsed, "state": state.rawValue])
            if state == .runningBackground || state == .runningBackgroundSuspended { sawBackground = true }
            if state == .runningBackgroundSuspended { sawSuspension = true }
            if state == .notRunning { failure = "Fixture terminated in background; do not activate and mask a relaunch" }
            if XCUIApplication(bundleIdentifier: "app.slax.reader").state != .notRunning { failure = "Production application is no longer closed" }
            if elapsed >= 5 && state != .runningBackground && state != .runningBackgroundSuspended {
                failure = "Fixture did not remain backgrounded"
            }
            return failure != nil || elapsed >= 30
        }, object: nil)
        let result = XCTWaiter.wait(for: [observation], timeout: 40)
        retain(XCUIApplication(bundleIdentifier: "com.apple.springboard"), name: name + "-while-backgrounded")
        guard result == .completed, failure == nil, sawBackground,
              target.state == .runningBackground || target.state == .runningBackgroundSuspended else {
            throw rejected(target, failure ?? "Bounded background-state observation failed")
        }
        target.activate()
        try requireOwnForeground(target)
        let afterPID = observedPID(target)
        retainJSON(["beforePID": beforePID.map { $0 as Any } ?? NSNull(), "afterPID": afterPID.map { $0 as Any } ?? NSNull(),
                    "pidEvidence": beforePID != nil && afterPID != nil ? "observed in XCTest application debugDescription" : "unavailable; no same-process claim",
                    "backgroundAndResumeSeconds": ProcessInfo.processInfo.systemUptime - start], name: name + "-process-continuity")
        retain(target, name: name + "-after-resume")
        if let beforePID, let afterPID { XCTAssertEqual(afterPID, beforePID, "Resuming must not silently relaunch the fixture") }
    }
    private func observedPID(_ target: XCUIApplication) -> Int? {
        let firstLine = String(target.debugDescription.split(separator: "\n").first ?? "")
        guard firstLine.hasPrefix("Attributes: Application,"),
              let range = firstLine.range(of: #"\bpid: [0-9]+"#, options: .regularExpression) else { return nil }
        return Int(firstLine[range].dropFirst(5))
    }
    private func unique(_ query: XCUIElementQuery, in target: XCUIApplication, name: String, hittable: Bool = true) throws -> XCUIElement {
        try waitUntil(target, name: name) {
            let elements = query.allElementsBoundByIndex.filter { $0.exists }
            return elements.count == 1 && (!hittable || elements[0].isHittable)
        }
        let elements = query.allElementsBoundByIndex.filter { $0.exists }
        guard elements.count == 1, let element = elements.first, element.frame.width > 0, element.frame.height > 0 else {
            throw rejected(target, "Missing or ambiguous \(name); do not substitute another element")
        }
        return element
    }
    private func waitUntil(_ target: XCUIApplication, name: String, timeout: TimeInterval = 8, _ condition: @escaping () -> Bool) throws {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        guard XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed else {
            throw rejected(target, "Unmet native condition: \(name); inspect retained evidence rather than guessing another control")
        }
    }
    private func rejected(_ target: XCUIApplication, _ message: String) -> NSError {
        retain(target, name: "rejected-native-condition")
        retain(XCUIApplication(bundleIdentifier: "com.apple.springboard"), name: "rejected-system-state")
        return NSError(domain: "ControlledReaderInput", code: 10, userInfo: [NSLocalizedDescriptionKey: message])
    }
    private func retainJSON(_ value: [String: Any], name: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .prettyPrinted]),
              let text = String(data: data, encoding: .utf8) else {
            XCTFail("Cannot retain native observation \(name)")
            return
        }
        let attachment = XCTAttachment(string: text)
        attachment.name = name + ".json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    private func nativeBack(_ target: XCUIApplication) throws -> XCUIElement {
        // Actual native RNSScreen accessibility identifies this as BackButton
        // with the prior route's Library label, rather than a generic Back label.
        let back = try unique(target.navigationBars.buttons.matching(identifier: "BackButton"), in: target, name: "native-back")
        XCTAssertLessThan(back.frame.minX, target.frame.width * 0.25)
        XCTAssertLessThan(back.frame.maxY, target.frame.height * 0.25)
        XCTAssertEqual(back.label, "Library", "Refuse a different navigation destination in this prepared English route")
        return back
    }
    private func requireLibrary(_ target: XCUIApplication) throws {
        for label in ["Switch List", "Menu", "Add Link"] {
            _ = try unique(target.buttons.matching(NSPredicate(format: "label == %@", label)), in: target, name: "library-\(label)")
        }
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
        let available = target.state != .notRunning && target.state != .unknown
        let screenshot = XCTAttachment(screenshot: available ? target.screenshot() : XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: available ? target.debugDescription : "Application AX tree unavailable; observed state=\(target.state.rawValue). Screen captured without launching.")
        tree.name = name + "-native-tree"
        tree.lifetime = .keepAlways
        add(tree)
    }
}

@MainActor final class RuntimeLifecycleControl: XCTestCase {
    func testProductionRuntimeBackgroundAndResume() throws {
        continueAfterFailure = false
        #if targetEnvironment(simulator)
        let expected = ProcessInfo.processInfo.environment["SLAX_LIFECYCLE_SIMULATOR"]
        let actual = ProcessInfo.processInfo.environment["SIMULATOR_UDID"]
        guard let expected, !expected.isEmpty, expected == actual else {
            throw NSError(domain: "ControlledLifecycle", code: 1, userInfo: [NSLocalizedDescriptionKey: "Exact allocated lifecycle simulator is required"])
        }
        #else
        throw NSError(domain: "ControlledLifecycle", code: 1, userInfo: [NSLocalizedDescriptionKey: "Physical devices are outside this fixture"])
        #endif
        let app = XCUIApplication(bundleIdentifier: "app.slax.reader")
        XCTAssertEqual(app.state, .runningForeground, "Only an already prepared synthetic runtime may be exercised")
        let status = app.staticTexts["native-runtime-lifecycle-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        XCTAssertEqual(status.label, "Native lifecycle ready")
        for cycle in 1...2 {
            let start = ProcessInfo.processInfo.systemUptime
            var samples: [[String: Any]] = []
            var stopped = false
            XCUIDevice.shared.press(.home)
            let observation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let elapsed = ProcessInfo.processInfo.systemUptime - start
                let state = app.state
                samples.append(["seconds": elapsed, "state": state.rawValue])
                if state == .notRunning || state == .unknown { stopped = true }
                return stopped || elapsed >= 30
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [observation], timeout: 40), .completed)
            XCTAssertFalse(stopped, "Do not relaunch a runtime killed while backgrounded")
            XCTAssertTrue(app.state == .runningBackground || app.state == .runningBackgroundSuspended)
            let states = XCTAttachment(string: String(data: try JSONSerialization.data(withJSONObject: samples), encoding: .utf8)!)
            states.name = "runtime-background-\(cycle).json"; states.lifetime = .keepAlways; add(states)
            app.activate()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
            let verified = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Native lifecycle passed: \(cycle)"), object: status)
            XCTAssertEqual(XCTWaiter.wait(for: [verified], timeout: 15), .completed)
            let frame = XCTAttachment(screenshot: app.screenshot())
            frame.name = "runtime-resumed-\(cycle)"; frame.lifetime = .keepAlways; add(frame)
        }
    }
}
