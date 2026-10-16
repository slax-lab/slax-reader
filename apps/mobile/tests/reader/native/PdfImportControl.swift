import XCTest

@MainActor final class PdfImportControl: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "app.slax.reader.uifixture")
  private var fixtureVerified = false

  override func setUpWithError() throws {
    continueAfterFailure = false
    let environment = ProcessInfo.processInfo.environment
    let expected = try XCTUnwrap(environment["SLAX_PDF_SIMULATOR"])
    XCTAssertNotNil(UUID(uuidString: expected))
    XCTAssertEqual(environment["SIMULATOR_UDID"], expected)
    XCTAssertNotEqual(app.state, .notRunning)
    app.activate()
    XCTAssertTrue(app.buttons["Add Link"].firstMatch.waitForExistence(timeout: 20), app.debugDescription)
    XCTAssertFalse(app.buttons["Synthetic native PDF import"].exists)
    fixtureVerified = true
  }

  private func capture(_ name: String) {
    guard fixtureVerified else { return }
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
  }

  override func tearDownWithError() throws { capture("pdf-import-final") }

  func testNativePickerCancelAndInspect() throws {
    app.buttons["Add Link"].firstMatch.tap()
    let importFile = app.buttons["add-pdf-file"].firstMatch
    XCTAssertTrue(importFile.waitForExistence(timeout: 10), app.debugDescription)
    importFile.tap()
    let choose = app.buttons["Choose PDF"].firstMatch
    XCTAssertTrue(choose.waitForExistence(timeout: 10), app.debugDescription)
    choose.tap()
    let cancel = app.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "取消"])).firstMatch
    XCTAssertTrue(cancel.waitForExistence(timeout: 10), app.debugDescription)
    capture("pdf-native-picker-before-cancel")
    cancel.tap()
    XCTAssertTrue(choose.waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertFalse(app.buttons["Upload"].firstMatch.isEnabled, app.debugDescription)
    capture("pdf-native-picker-null-cancel")
    choose.tap()
    XCTAssertTrue(cancel.waitForExistence(timeout: 10), app.debugDescription)
    capture("pdf-native-picker-seed-location")
    let browse = app.tabBars.buttons.matching(NSPredicate(format: "label IN %@", ["Browse", "浏览"])).firstMatch
    if browse.exists { browse.tap() }
    let local = app.cells.matching(NSPredicate(format: "label IN %@", ["On My iPhone", "On My iPad", "我的iPhone", "我的iPad"])).firstMatch
    if local.waitForExistence(timeout: 3) { local.tap() }
    let slax = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", "Slax Reader")).firstMatch
    if slax.waitForExistence(timeout: 3) { slax.tap() }
    let seedFolder = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "slax-ui-fixture-import")).firstMatch
    XCTAssertTrue(seedFolder.waitForExistence(timeout: 10), app.debugDescription)
    seedFolder.tap()
    let run = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "reader-pdf-import-")).firstMatch
    XCTAssertTrue(run.waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertEqual(app.cells.matching(NSPredicate(format: "label CONTAINS %@", "reader-pdf-import-")).count, 1, "Only one current fixture seed directory is allowed")
    run.tap()
    let seed = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "slax-synthetic-eight-pages")).firstMatch
    XCTAssertTrue(seed.waitForExistence(timeout: 10), app.debugDescription)
    capture("pdf-native-picker-exact-seed")
    seed.tap()
    XCTAssertTrue(choose.waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertTrue(app.staticTexts["slax-synthetic-eight-pages.pdf"].firstMatch.exists, app.debugDescription)
    let upload = app.buttons["Upload"].firstMatch
    XCTAssertTrue(upload.isEnabled, app.debugDescription)
    capture("pdf-native-copy-ready")
    upload.tap()
    let pending = app.staticTexts["The file is saved. Waiting for Inbox synchronization…"].firstMatch
    XCTAssertTrue(pending.waitForExistence(timeout: 2), app.debugDescription)
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = "pdf-upload-simulated-sync-pending"; image.lifetime = .keepAlways; add(image)
    XCTAssertTrue(app.otherElements["reader-pdf"].firstMatch.waitForExistence(timeout: 20), app.debugDescription)
    XCTAssertTrue(app.staticTexts["Synthetic native PDF import"].firstMatch.exists, app.debugDescription)
    XCTAssertTrue(app.webViews.staticTexts["Alpha selectable PDF text. Highlight this sentence."].firstMatch.waitForExistence(timeout: 15), app.debugDescription)
    capture("pdf-real-picker-upload-simulated-sync-reader")
  }
}
