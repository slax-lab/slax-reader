import ExpoModulesCore
import GoogleSignIn
import UIKit

/** Keep provider redirects in the native SDK before the general linking handler. */
public final class SlaxGoogleAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    guard let scheme = url.scheme,
      scheme.hasPrefix("com.googleusercontent.apps."),
      let types = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]],
      types.contains(where: { ($0["CFBundleURLSchemes"] as? [String])?.contains(scheme) == true })
    else { return false }
    return GIDSignIn.sharedInstance.handle(url)
  }
}
