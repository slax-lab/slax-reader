import AuthenticationServices
import ExpoModulesCore
import UIKit

final class SlaxPasskeys: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  private var controller: ASAuthorizationController?
  private var promise: Promise?
  private var window: UIWindow?

  func perform(options: String, register: Bool, window: UIWindow, promise: Promise) throws {
    guard controller == nil else { throw failure("A passkey operation is already active") }
    guard let data = options.data(using: .utf8), let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let challenge = value["challenge"] as? String else { throw failure("Invalid passkey options") }
    let request: ASAuthorizationRequest
    if register {
      guard let rp = value["rp"] as? [String: Any], let domain = rp["id"] as? String,
        let user = value["user"] as? [String: Any], let id = user["id"] as? String, let name = user["name"] as? String else { throw failure("Invalid passkey registration options") }
      let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: domain)
      let registration = provider.createCredentialRegistrationRequest(challenge: try decode(challenge), name: name, userID: try decode(id))
      registration.displayName = user["displayName"] as? String
      registration.userVerificationPreference = .required
      // Platform passkeys use ES256. Reject an unsupported server algorithm contract.
      guard let algorithms = value["pubKeyCredParams"] as? [[String: Any]], algorithms.contains(where: { ($0["alg"] as? Int) == -7 }) else { throw failure("Unsupported passkey algorithm") }
      if #available(iOS 17.4, *) {
        registration.excludedCredentials = try descriptors(value["excludeCredentials"])
      }
      request = registration
    } else {
      guard let domain = value["rpId"] as? String else { throw failure("Invalid passkey authentication options") }
      let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: domain)
      let assertion = provider.createCredentialAssertionRequest(challenge: try decode(challenge))
      assertion.userVerificationPreference = .required
      assertion.allowedCredentials = try descriptors(value["allowCredentials"])
      request = assertion
    }
    self.promise = promise
    self.window = window
    let authorization = ASAuthorizationController(authorizationRequests: [request])
    controller = authorization
    authorization.delegate = self
    authorization.presentationContextProvider = self
    authorization.performRequests()
  }

  func cancel() {
    controller?.cancel()
    finish(nil)
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { window! }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    guard controller === self.controller else { return }
    var result: [String: Any]
    if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
      guard let attestation = credential.rawAttestationObject else { reject(failure("Missing passkey attestation")); return }
      result = ["id": encode(credential.credentialID), "rawId": encode(credential.credentialID), "type": "public-key", "authenticatorAttachment": "platform",
        "clientExtensionResults": [:], "response": ["clientDataJSON": encode(credential.rawClientDataJSON), "attestationObject": encode(attestation)]]
    } else if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
      result = ["id": encode(credential.credentialID), "rawId": encode(credential.credentialID), "type": "public-key", "authenticatorAttachment": "platform",
        "clientExtensionResults": [:], "response": ["clientDataJSON": encode(credential.rawClientDataJSON), "authenticatorData": encode(credential.rawAuthenticatorData), "signature": encode(credential.signature), "userHandle": encode(credential.userID)]]
    } else { reject(failure("Unexpected passkey response")); return }
    do {
      let data = try JSONSerialization.data(withJSONObject: result)
      finish(String(decoding: data, as: UTF8.self))
    } catch { reject(error) }
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    guard controller === self.controller else { return }
    if let error = error as? ASAuthorizationError, error.code == .canceled { finish(nil) }
    else { reject(error) }
  }

  private func finish(_ result: String?) {
    let pending = promise
    promise = nil; controller = nil; window = nil
    pending?.resolve(result)
  }
  private func reject(_ error: Error) {
    let pending = promise
    promise = nil; controller = nil; window = nil
    pending?.reject(error)
  }
  private func descriptors(_ value: Any?) throws -> [ASAuthorizationPlatformPublicKeyCredentialDescriptor] {
    guard let value else { return [] }
    guard let items = value as? [[String: Any]] else { throw failure("Invalid passkey descriptors") }
    return try items.map { item in
      guard let id = item["id"] as? String else { throw failure("Invalid passkey credential ID") }
      return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: try decode(id))
    }
  }
  private func decode(_ value: String) throws -> Data {
    let base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    guard let data = Data(base64Encoded: base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4)) else { throw failure("Invalid passkey base64url") }
    return data
  }
  private func encode(_ value: Data) -> String {
    value.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
  private func failure(_ message: String) -> NSError { NSError(domain: "SlaxPasskeys", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
