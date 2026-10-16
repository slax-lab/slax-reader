import XCTest

@MainActor final class PdfSelectionControl: PdfNativeAcceptance {
  private var title: String { ProcessInfo.processInfo.environment["SLAX_PDF_TITLE"] ?? "Eight-page selectable PDF fixture" }

  override func setUpWithError() throws {
    try super.setUpWithError()
    XCTAssertTrue(["Eight-page selectable PDF fixture", "Loopback HTTP PDF fixture"].contains(title))
    verifyFixture(title)
    requireDocument()
  }

  func testNativeUnifiedScrollSelectionHighlightAndComment() throws {
    assertNoPdfChrome()
    let text = app.webViews.staticTexts[paragraph].firstMatch
    let overview = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Overview:")).firstMatch
    XCTAssertTrue(text.waitForExistence(timeout: 20) && text.isHittable, app.debugDescription)
    XCTAssertTrue(overview.exists && overview.isHittable, app.debugDescription)
    let initialText = text.frame, initialOverview = overview.frame
    capture("pdf-single-scroll-before")
    swipeDocumentUp(distance: 90)
    XCTAssertTrue(text.isHittable && overview.isHittable, "Use the fresh fixture at its initial top position. \(app.debugDescription)")
    let textDelta = initialText.minY - text.frame.minY
    let headerDelta = initialOverview.minY - overview.frame.minY
    XCTAssertGreaterThan(textDelta, 20, "A native body swipe must move the PDF")
    XCTAssertGreaterThan(headerDelta, 20, "The native header must move with the body, not remain in a separate scroller")
    XCTAssertEqual(textDelta, headerDelta, accuracy: 8, "Header and PDF must share the native scroll displacement")
    let geometry = XCTAttachment(string: "headerBefore=\(initialOverview) headerAfter=\(overview.frame) textBefore=\(initialText) textAfter=\(text.frame)")
    geometry.name = "pdf-single-scroll-native-geometry"; geometry.lifetime = .keepAlways; add(geometry)
    capture("pdf-single-scroll-header-partially-moved")
    assertNoPdfChrome()

    text.press(forDuration: 1.2)
    let bar = app.otherElements["selection_action_bar"].firstMatch
    XCTAssertTrue(bar.waitForExistence(timeout: 8), app.debugDescription)
    for label in ["Copy", "Highlight", "Comment"] { XCTAssertTrue(bar.buttons[label].exists && bar.buttons[label].isHittable, app.debugDescription) }
    assertNoSystemMenu()
    XCTAssertTrue(app.frame.contains(bar.frame), "Selection actions must remain inside the native viewport")
    capture("pdf-native-selection-after-header-scroll")
    bar.buttons["Highlight"].tap()
    settle()
    requireDocument()
    text.press(forDuration: 1.2)
    XCTAssertTrue(bar.waitForExistence(timeout: 8), app.debugDescription)
    assertNoSystemMenu()
    bar.buttons["Comment"].tap()
    assertQuote()
    let editor = app.textViews["reader-comment-input"].firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 8), app.debugDescription)
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8), app.debugDescription)
    editor.typeText("Native PDF single-scroll fixture comment")
    XCTAssertEqual(editor.value as? String, "Native PDF single-scroll fixture comment")
    capture("pdf-native-single-scroll-comment-keyboard")
    let send = app.buttons["reader-comment-send"].firstMatch
    XCTAssertTrue(send.exists && send.isEnabled)
    send.tap()
    let saved = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label ENDSWITH %@", "reader-comment-", "Native PDF single-scroll fixture comment")).firstMatch
    XCTAssertTrue(saved.waitForExistence(timeout: 8), app.debugDescription)
    app.buttons["Close comment panel"].tap()
    openExactNote()
    XCTAssertTrue(app.buttons["Remove existing highlight"].firstMatch.waitForExistence(timeout: 8), app.debugDescription)
    XCTAssertTrue(saved.waitForExistence(timeout: 8), app.debugDescription)
    capture("pdf-toolbar-note-restores-exact-quote-and-comment")
  }

  func testNativeSwipeBackgroundReopenAndNoteAnchor() throws {
    assertNoPdfChrome()
    let text = app.webViews.staticTexts[paragraph].firstMatch
    XCTAssertTrue(text.waitForExistence(timeout: 20) && text.isHittable, app.debugDescription)
    text.press(forDuration: 1.2)
    let bar = app.otherElements["selection_action_bar"].firstMatch
    XCTAssertTrue(bar.waitForExistence(timeout: 8), app.debugDescription)
    assertNoSystemMenu()
    bar.buttons["Highlight"].tap()
    settle()
    let anchor = revealPage(4, maximumSwipes: 12)
    XCTAssertTrue(anchor.isHittable)
    XCTAssertFalse(app.staticTexts[title].firstMatch.isHittable, "The header must scroll off with the document")
    let position = anchor.frame.minY
    assertNoPdfChrome()
    capture("pdf-native-swipe-page-four")
    backgroundAndResume()
    XCTAssertTrue(anchor.waitForExistence(timeout: 10) && anchor.isHittable, app.debugDescription)
    XCTAssertEqual(anchor.frame.minY, position, accuracy: 20)
    capture("pdf-native-single-scroll-background-resume")
    reopen(title)
    XCTAssertTrue(anchor.waitForExistence(timeout: 15) && anchor.isHittable, app.debugDescription)
    XCTAssertEqual(anchor.frame.minY, position, accuracy: 30)
    assertNoPdfChrome()
    capture("pdf-native-single-scroll-position-reopened")
    openExactNote()
    XCTAssertTrue(app.buttons["Remove existing highlight"].firstMatch.waitForExistence(timeout: 8), app.debugDescription)
    app.buttons["Close comment panel"].tap()
    let first = app.webViews.staticTexts["Page 1 selection anchor: violet river 1."].firstMatch
    XCTAssertTrue(first.waitForExistence(timeout: 10) && first.isHittable, app.debugDescription)
    capture("pdf-native-single-scroll-note-anchor")
  }
}
