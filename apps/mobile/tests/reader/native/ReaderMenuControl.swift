import XCTest

@MainActor final class ReaderMenuControl: XCTestCase {
  private func screenshot(_ app: XCUIApplication, _ name: String) {
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
  }

  func testReaderMenuAndCommentEditorClipboard() throws {
    continueAfterFailure = false
    let environment = ProcessInfo.processInfo.environment
    let expectedDevice = try XCTUnwrap(environment["SLAX_READER_MENU_SIMULATOR"])
    XCTAssertEqual(environment["SIMULATOR_UDID"], expectedDevice)
    let paragraph = try XCTUnwrap(environment["SLAX_READER_MENU_PARAGRAPH"])
    let app = XCUIApplication(bundleIdentifier: environment["SLAX_READER_MENU_BUNDLE"] ?? "app.slax.reader")
    XCTAssertNotEqual(app.state, .notRunning, "Launch the isolated English Reader fixture first; this test never initializes installation state")
    app.activate()
    XCTAssertTrue(app.otherElements["reader-screen"].firstMatch.waitForExistence(timeout: 10))
    let text = app.webViews.staticTexts[paragraph].firstMatch
    XCTAssertTrue(text.waitForExistence(timeout: 10) && text.isHittable, app.debugDescription)
    let ownBar = app.otherElements["selection_action_bar"].firstMatch
    func assertNoSystemMenu() {
      XCTAssertEqual(app.buttons["Copy"].count, ownBar.exists ? ownBar.buttons["Copy"].count : 0, "Copy must not escape Slax's action bar")
      XCTAssertEqual(app.menus.count, 0, app.debugDescription)
      XCTAssertEqual(app.menuItems.count, 0, app.debugDescription)
      XCTAssertFalse(app.buttons["Look Up"].exists, app.debugDescription)
      XCTAssertFalse(app.buttons["Translate"].exists, app.debugDescription)
    }
    text.press(forDuration: 1)
    XCTAssertTrue(ownBar.waitForExistence(timeout: 5), app.debugDescription)
    XCTAssertTrue(ownBar.buttons["Copy"].exists)
    XCTAssertTrue(ownBar.buttons["Highlight"].exists)
    XCTAssertTrue(ownBar.buttons["Comment"].exists)
    XCTAssertEqual(app.buttons["Copy"].count, 1, "The only Copy action must belong to Slax")
    assertNoSystemMenu()
    screenshot(app, "reader-own-selection-no-system-menu")
    ownBar.buttons["Highlight"].tap()
    assertNoSystemMenu()
    screenshot(app, "reader-after-highlight-no-system-menu")

    text.press(forDuration: 1)
    XCTAssertTrue(ownBar.waitForExistence(timeout: 5), app.debugDescription)
    ownBar.buttons["Comment"].tap()
    let editor = app.textViews["reader-comment-input"].firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 5) && editor.isHittable, app.debugDescription)
    assertNoSystemMenu()
    screenshot(app, "reader-after-comment-no-system-menu")
    editor.tap()
    editor.typeText("Clipboard fixture")
    editor.press(forDuration: 1)
    let selectAll = app.buttons["Select All"].firstMatch
    XCTAssertTrue(selectAll.waitForExistence(timeout: 5), app.debugDescription)
    selectAll.tap()
    let copy = app.buttons["Copy"].firstMatch
    XCTAssertTrue(copy.waitForExistence(timeout: 5), "Native comment TextInput Copy remains available")
    copy.tap()
    editor.tap()
    editor.press(forDuration: 1)
    XCTAssertTrue(selectAll.waitForExistence(timeout: 5), app.debugDescription)
    selectAll.tap()
    editor.typeText("Replacement")
    editor.press(forDuration: 1)
    let paste = app.buttons["Paste"].firstMatch
    XCTAssertTrue(paste.waitForExistence(timeout: 5), "Native comment TextInput Paste remains available")
    paste.tap()
    XCTAssertTrue((editor.value as? String)?.contains("Clipboard fixture") == true, app.debugDescription)
    screenshot(app, "comment-editor-system-clipboard-preserved")
  }
}
