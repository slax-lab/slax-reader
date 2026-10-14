import XCTest

@MainActor class PdfNativeAcceptance: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "app.slax.reader.uifixture")
  var fixtureVerified = false
  var paragraph: String { ProcessInfo.processInfo.environment["SLAX_PDF_TEXT"] ?? "Alpha selectable PDF text. Highlight this sentence." }
  var selectedText: String { ProcessInfo.processInfo.environment["SLAX_PDF_SELECTED_TEXT"] ?? "text" }

  override func setUpWithError() throws {
    continueAfterFailure = false
    let environment = ProcessInfo.processInfo.environment
    let expected = try XCTUnwrap(environment["SLAX_PDF_SIMULATOR"], "An explicitly allocated fixture simulator is required")
    XCTAssertNotNil(UUID(uuidString: expected))
    XCTAssertEqual(environment["SIMULATOR_UDID"], expected)
    XCTAssertNotEqual(app.state, .notRunning, "Prepare the isolated fixture before running; tests do not launch or seed the application")
    app.activate()
    XCTAssertFalse(paragraph.isEmpty)
    XCTAssertFalse(selectedText.isEmpty)
    XCTAssertTrue(paragraph.contains(selectedText))
  }

  func verifyFixture(_ title: String) {
    let heading = app.staticTexts[title].firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 20), app.debugDescription)
    fixtureVerified = true
  }

  func requireDocument() {
    XCTAssertTrue(app.otherElements["pdf-reader-container"].firstMatch.waitForExistence(timeout: 20), app.debugDescription)
    XCTAssertTrue(app.otherElements["pdf-document"].firstMatch.waitForExistence(timeout: 20), app.debugDescription)
    XCTAssertFalse(app.otherElements["reader-pdf-loading-or-error"].firstMatch.exists, app.debugDescription)
  }

  func capture(_ name: String) {
    guard fixtureVerified else { return }
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
  }

  override func tearDownWithError() throws { capture("pdf-native-final-state") }

  func settle(_ seconds: TimeInterval = 0.5) {
    let end = Date().addingTimeInterval(seconds)
    let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in Date() >= end }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: seconds + 2), .completed)
  }

  func assertNoPdfChrome() {
    for id in ["reader-pdf-viewport", "reader-pdf-text-status", "reader-pdf-download", "reader-pdf-notes"] {
      XCTAssertFalse(app.descendants(matching: .any).matching(identifier: id).firstMatch.exists, "Removed Reader chrome: \(id)")
    }
    for label in ["Previous page", "Next page", "Zoom in", "Zoom out", "Fit to width", "Available offline", "Download for offline reading", "Downloading…", "Notes", "AI is not available for this document yet. Try again later.", "This PDF has no extractable text. Pages remain readable.", "Text extraction failed. Pages remain readable."] {
      XCTAssertFalse(app.buttons[label].firstMatch.exists, "Unexpected Reader-only status/control: \(label)")
      XCTAssertFalse(app.staticTexts[label].firstMatch.exists, "Unexpected Reader-only status/control: \(label)")
    }
    XCTAssertFalse(app.webViews.textFields["Page"].firstMatch.exists)
    XCTAssertEqual(app.webViews.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "[0-9]+%|/ ?[0-9]+")).count, 0)
  }

  func assertNoSystemMenu() {
    XCTAssertEqual(app.menus.count, 0, app.debugDescription)
    XCTAssertEqual(app.menuItems.count, 0, app.debugDescription)
    let bar = app.otherElements["selection_action_bar"].firstMatch
    XCTAssertEqual(app.buttons.matching(identifier: "Copy").count, bar.buttons.matching(identifier: "Copy").count, app.debugDescription)
  }

  func action(_ id: String) -> XCUIElement {
    let more = app.buttons["reader-header-more"].firstMatch
    if !more.exists || !more.isHittable {
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.90, dy: 0.70)).tap()
      settle()
    }
    XCTAssertTrue(more.waitForExistence(timeout: 8) && more.isHittable, app.debugDescription)
    more.tap()
    let item = app.buttons["reader-toolbar-\(id)"].firstMatch
    XCTAssertTrue(item.waitForExistence(timeout: 8) && item.isHittable, app.debugDescription)
    return item
  }

  func openExactNote() {
    let notes = action("pdf-notes")
    XCTAssertTrue(notes.isEnabled, app.debugDescription)
    notes.tap()
    let list = app.otherElements["reader-pdf-note-list"].firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 8), app.debugDescription)
    let passage = list.buttons["Page 1, \(selectedText)"].firstMatch
    XCTAssertTrue(passage.exists && passage.isHittable, app.debugDescription)
    XCTAssertEqual(passage.label, "Page 1, \(selectedText)")
    passage.tap()
    assertQuote()
  }

  func assertQuote() {
    let quote = app.staticTexts["reader-comment-quote"].firstMatch
    XCTAssertTrue(quote.waitForExistence(timeout: 8), app.debugDescription)
    XCTAssertEqual(quote.label, selectedText)
  }

  func swipeDocumentUp(distance: CGFloat? = nil) {
    let frame = app.frame
    let startY = min(frame.maxY - 140, frame.height * 0.78)
    let endY = max(frame.minY + 140, startY - (distance ?? frame.height * 0.50))
    let origin = app.coordinate(withNormalizedOffset: .zero)
    origin.withOffset(CGVector(dx: frame.width * 0.64, dy: startY)).press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: frame.width * 0.64, dy: endY)), withVelocity: .slow, thenHoldForDuration: 0.35)
    settle()
  }

  func revealPage(_ number: Int, maximumSwipes: Int) -> XCUIElement {
    let anchor = app.webViews.staticTexts["Page \(number) selection anchor: violet river \(number)."].firstMatch
    for _ in 0..<maximumSwipes {
      if anchor.exists && anchor.isHittable { return anchor }
      swipeDocumentUp()
    }
    XCTAssertTrue(anchor.exists && anchor.isHittable, "Page \(number) was not reached within \(maximumSwipes) real swipes. \(app.debugDescription)")
    return anchor
  }

  func backgroundAndResume() {
    XCUIDevice.shared.press(.home)
    XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
    settle(3)
    app.activate()
    requireDocument()
  }

  func reopen(_ title: String) {
    app.navigationBars.buttons["BackButton"].firstMatch.tap()
    let bookmark = app.buttons[title].firstMatch
    XCTAssertTrue(bookmark.waitForExistence(timeout: 10) && bookmark.isHittable, app.debugDescription)
    bookmark.tap()
    requireDocument()
  }
}
