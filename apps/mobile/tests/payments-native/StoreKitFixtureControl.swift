import Foundation
import StoreKit
import StoreKitTest
import XCTest

/// Only an independently allocated synthetic StoreKit simulator is accepted.
@available(iOS 17.0, *)
@MainActor final class StoreKitFixtureControl: XCTestCase {
    private enum FixtureGuardError: Error { case refused }
    private func require(_ condition: Bool, _ message: String) throws {
        guard condition else { XCTFail(message); throw FixtureGuardError.refused }
    }
    private struct Run: Decodable {
        let device: String, runId: String, nonce: String, bundleIdentifier: String
        let orderId: String, monthlyProduct: String, calibrationProduct: String, configurationIdentifier: String
        let createdAt: Double
    }
    private func run() throws -> Run {
        continueAfterFailure = false
        let resource = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture-run", withExtension: "json"))
        let value = try JSONDecoder().decode(Run.self, from: Data(contentsOf: resource))
        try require(value.device == ProcessInfo.processInfo.environment["SIMULATOR_UDID"], "Allocated simulator does not match")
        try require(value.bundleIdentifier == "app.slax.reader.storekitfixture", "Only the isolated local application is permitted")
        try require(UUID(uuidString: value.nonce) != nil && UUID(uuidString: value.orderId) != nil && UUID(uuidString: value.configurationIdentifier) != nil, "Synthetic run/order/configuration UUIDs are required")
        let prefix = "slax.local.fixture." + value.nonce.lowercased().replacingOccurrences(of: "-", with: "") + "."
        try require(value.monthlyProduct == prefix + "monthly" && value.calibrationProduct == prefix + "probe", "Real or unrelated product identifiers are prohibited")
        let age = Date().timeIntervalSince1970 * 1000 - value.createdAt
        try require(age >= 0 && age <= 20 * 60 * 1000, "Fresh native calibration input is required")
        return value
    }
    private func session(_ input: Run) async throws -> SKTestSession {
        let file = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Local", withExtension: "storekit"))
        let contents = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        try require(contents["identifier"] as? String == input.configurationIdentifier, "Local configuration belongs to another run")
        let value = try SKTestSession(contentsOf: file)
        // This mutation must reach the configured local daemon before any purchase.
        try await value.setSimulatedError(nil, forAPI: .purchase)
        value.disableDialogs = true
        value.timeRate = .realTime
        return value
    }
    func testNativeXcodeConfigurationPreflight() async throws {
        let input = try run(), local = try await session(input)
        try require(XCUIApplication(bundleIdentifier: input.bundleIdentifier).state == .notRunning, "Adapter application stays closed during calibration")
        try require(local.allTransactions().isEmpty, "A fresh local StoreKit store is required; existing transactions are not erased")
        let catalog = try await Product.products(for: [input.monthlyProduct, input.calibrationProduct])
        try require(catalog.count == 2 && Set(catalog.map(\.id)) == Set([input.monthlyProduct, input.calibrationProduct]), "Native catalog differs from the exact synthetic local catalog")
        let calibration = try await local.buyProduct(identifier: input.calibrationProduct, options: [.appAccountToken(try XCTUnwrap(UUID(uuidString: input.orderId)))])
        try require(calibration.environment == .xcode && calibration.appBundleID == input.bundleIdentifier && calibration.productID == input.calibrationProduct, "No sandbox, production or unrelated transaction can enable the adapter")
        let transactions = local.allTransactions()
        let matching = transactions.filter { $0.productIdentifier == input.calibrationProduct }
        try require(matching.count == 1, "One actual local calibration transaction is required")
        await calibration.finish()
        try local.deleteTransaction(identifier: try XCTUnwrap(matching.first).identifier)
        try require(local.allTransactions().isEmpty, "The completed synthetic calibration must leave no pending transaction")
        let proof: [String: Any] = ["kind": "slax-controlled-native-storekit-preflight", "version": 1, "device": input.device, "runId": input.runId, "nonce": input.nonce, "createdAt": Int(Date().timeIntervalSince1970 * 1000), "bundleIdentifier": input.bundleIdentifier, "configurationIdentifier": input.configurationIdentifier, "calibrationProduct": input.calibrationProduct, "environment": "Xcode", "configurationMutationSucceeded": true, "calibrationFinished": true, "productIdentifiers": catalog.map(\.id).sorted()]
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: proof, options: [.sortedKeys]), uniformTypeIdentifier: "public.json")
        attachment.name = "storekit-native-xcode-preflight"; attachment.lifetime = .keepAlways; add(attachment)
        // An external owned controller validates this actual completed attachment before writing app input/proof.
    }
    func testActualAdapterPurchaseAndRestore() async throws {
        let input = try run(), local = try await session(input)
        try require(local.allTransactions().isEmpty, "The adapter scenario requires the calibrated empty local store")
        let app = XCUIApplication(bundleIdentifier: input.bundleIdentifier)
        try require(app.state != .notRunning, "A separate owned controller must first admit the native proof and attach the dedicated development bundle")
        app.activate()
        defer {app.terminate()}
        try require(app.alerts.count == 0, "Unexpected account/system prompts abort the local test")
        let purchase = app.buttons["storekit-fixture-purchase"]
        try require(purchase.waitForExistence(timeout: 20) && purchase.isHittable, "Actual guarded adapter must initialize from the native preflight; no UI fallback")
        purchase.tap()
        let success = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "success"), object: app.staticTexts["storekit-fixture-state"])
        XCTAssertEqual(XCTWaiter.wait(for: [success], timeout: 20), .completed, "Actual native callback and finish must complete")
        XCTAssertEqual(app.alerts.count, 0)
        let purchases = local.allTransactions().filter { $0.productIdentifier == input.monthlyProduct }
        XCTAssertEqual(purchases.count, 1)
        app.buttons["storekit-fixture-restore"].tap()
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "1"), object: app.staticTexts["storekit-fixture-native-restores"])
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 20), .completed)
        XCTAssertEqual(app.staticTexts["storekit-fixture-active-entitlements"].label, "1")
        let frame = XCTAttachment(screenshot: app.screenshot()); frame.name = "storekit-local-adapter-purchase-and-restore"; frame.lifetime = .keepAlways; add(frame)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = "storekit-local-adapter-tree"; tree.lifetime = .keepAlways; add(tree)
        // SQL/backend validation, restored event completion, cancellation and revocation need separate receipts/assertions.
    }
}
