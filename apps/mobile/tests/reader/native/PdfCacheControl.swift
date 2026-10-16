import XCTest

@MainActor final class PdfCacheControl: PdfNativeAcceptance {
  private let title = "Loopback HTTP PDF fixture"

  override func setUpWithError() throws {
    try super.setUpWithError()
    verifyFixture(title)
    requireDocument()
  }

  private func signalHost(_ marker: String) {
    print(marker)
    fflush(stdout)
  }

  private func stageReceipt(_ name: String) throws -> URL {
    let nonce = try XCTUnwrap(ProcessInfo.processInfo.environment["SLAX_PDF_HTTP_RUN"])
    XCTAssertNotNil(UUID(uuidString: nonce))
    return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("slax-pdf-http-\(nonce)-\(name).ready")
  }

  private func waitForHost(_ stage: String, timeout: TimeInterval = 40) throws {
    let receipt = try stageReceipt(stage)
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in FileManager.default.fileExists(atPath: receipt.path) }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: timeout), .completed, "Host did not validate stage \(stage); do not infer success from a toolbar state")
    XCTAssertEqual(try String(contentsOf: receipt, encoding: .utf8), "verified\n")
  }

  func testRealHttpCachedOfflineNativeSwipeAndReopen() throws {
    assertNoPdfChrome()
    let first = app.webViews.staticTexts[paragraph].firstMatch
    XCTAssertTrue(first.waitForExistence(timeout: 20) && first.isHittable, app.debugDescription)
    let download = action("pdf-download")
    XCTAssertTrue(download.isEnabled, "Use a fresh online HTTP fixture for the native download action")
    download.tap()
    signalHost("SLAX_PDF_HTTP_VERIFY_COMPLETE_AND_STOP")
    try waitForHost("offline")
    requireDocument()
    assertNoPdfChrome()
    capture("pdf-http-complete-before-offline-reopen")
    reopen(title)
    XCTAssertTrue(first.waitForExistence(timeout: 30) && first.isHittable, app.debugDescription)
    signalHost("SLAX_PDF_HTTP_VERIFY_NETWORK_ERROR")
    try waitForHost("network-error")
    capture("pdf-expo-fetch-error-cached-reader")
    let last = revealPage(30, maximumSwipes: 60)
    XCTAssertTrue(last.isHittable, app.debugDescription)
    assertNoPdfChrome()
    capture("pdf-http-offline-native-swipe-page-thirty")
    let position = last.frame.minY
    backgroundAndResume()
    XCTAssertTrue(last.waitForExistence(timeout: 10) && last.isHittable, app.debugDescription)
    XCTAssertEqual(last.frame.minY, position, accuracy: 20)
    reopen(title)
    XCTAssertTrue(last.waitForExistence(timeout: 30) && last.isHittable, app.debugDescription)
    XCTAssertEqual(last.frame.minY, position, accuracy: 30)
    assertNoPdfChrome()
    capture("pdf-http-offline-native-reopen-last-page")
    signalHost("SLAX_PDF_HTTP_VERIFY_FINAL")
    try waitForHost("final")
  }

  func testRealHttpMetadata404DoesNotUseCompleteCache() throws {
    let download = action("pdf-download")
    XCTAssertTrue(download.isEnabled)
    download.tap()
    signalHost("SLAX_PDF_HTTP_VERIFY_COMPLETE_AND_404")
    try waitForHost("metadata-404")
    app.navigationBars.buttons["BackButton"].firstMatch.tap()
    let bookmark = app.buttons[title].firstMatch
    XCTAssertTrue(bookmark.waitForExistence(timeout: 10) && bookmark.isHittable)
    bookmark.tap()
    let failure = app.otherElements["reader-pdf-loading-or-error"].firstMatch
    XCTAssertTrue(failure.waitForExistence(timeout: 30), app.debugDescription)
    XCTAssertTrue(app.buttons["Retry"].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertFalse(app.otherElements["pdf-reader-container"].firstMatch.exists)
    XCTAssertFalse(app.webViews.staticTexts[paragraph].firstMatch.exists)
    capture("pdf-http-404-fails-closed-with-existing-cache")
    signalHost("SLAX_PDF_HTTP_VERIFY_404")
    try waitForHost("http-404")
  }
}
