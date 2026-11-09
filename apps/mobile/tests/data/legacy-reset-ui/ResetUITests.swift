import XCTest

final class ResetUITests: XCTestCase {
  func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func dismissDeveloperMenu(_ app: XCUIApplication) {
    if app.buttons["Continue"].waitForExistence(timeout: 5) { app.buttons["Continue"].tap() }
    if app.buttons["xmark"].exists { app.buttons["xmark"].tap() }
    else if app.buttons["Close"].exists { app.buttons["Close"].tap() }
  }

  func testOldDataUpgradeAndRelogin() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "app.slax.reader")
    app.activate()
    if app.buttons["Enter URL manually"].waitForExistence(timeout: 5) {
      app.buttons["Enter URL manually"].tap()
      let url = app.textFields.firstMatch
      XCTAssertTrue(url.waitForExistence(timeout: 5), app.debugDescription)
      url.tap()
      url.typeText("http://127.0.0.1:8201")
      print("MANUAL URL UI: \(app.debugDescription)")
      if app.buttons["Connect"].exists { app.buttons["Connect"].tap() }
    }
    dismissDeveloperMenu(app)
    let article = app.buttons["Cloud article after reset"].firstMatch
    if app.buttons["同意"].exists { app.buttons["同意"].tap(); _ = article.waitForExistence(timeout: 15) }
    if !article.exists && app.buttons["Google 登录"].exists {
      let consent = app.otherElements["阅读并同意"].firstMatch
      if consent.exists { consent.tap() }
      app.buttons["Google 登录"].tap()
      if app.buttons["同意"].waitForExistence(timeout: 3) { app.buttons["同意"].tap() }
    }
    XCTAssertTrue(article.waitForExistence(timeout: 60), app.debugDescription)
    capture("01-ios-cloud-refill")
    article.tap()
    XCTAssertTrue(app.staticTexts["Cloud article after reset"].firstMatch.waitForExistence(timeout: 15), app.debugDescription)
    sleep(2)
    capture("02-ios-reader")
    let back = app.navigationBars.buttons.firstMatch
    XCTAssertTrue(back.waitForExistence(timeout: 10), app.debugDescription)
    back.tap()
    XCTAssertTrue(app.buttons["Menu"].waitForExistence(timeout: 10), app.debugDescription)
    app.buttons["Menu"].tap()
    let logout = app.buttons["退出登录"].firstMatch
    XCTAssertTrue(logout.waitForExistence(timeout: 10), app.debugDescription)
    logout.tap()
    let google = app.buttons["Google 登录"].firstMatch
    XCTAssertTrue(google.waitForExistence(timeout: 15), app.debugDescription)
    capture("03-ios-logout")
    let agreement = app.otherElements["阅读并同意"].firstMatch
    if agreement.exists { agreement.tap() }
    google.tap()
    if app.buttons["同意"].waitForExistence(timeout: 3) { app.buttons["同意"].tap() }
    XCTAssertTrue(article.waitForExistence(timeout: 60), app.debugDescription)
    capture("04-ios-relogin")
    app.terminate()
    app.launch()
    dismissDeveloperMenu(app)
    XCTAssertTrue(article.waitForExistence(timeout: 60), app.debugDescription)
    capture("05-ios-cold-restart")
  }
}
