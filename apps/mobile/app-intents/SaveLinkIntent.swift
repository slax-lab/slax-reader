import AppIntents
import Foundation
internal import ExpoAppIntents

struct SaveLinkIntent: AppIntent {
  static let title: LocalizedStringResource = "Save to Slax Reader"
  static let description = IntentDescription("Open Slax Reader to review and save a web link.")
  static let openAppWhenRun = true

  @Parameter(title: "URL") var url: URL
  @Parameter(title: "Title") var articleTitle: String?

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
      let host = components.host, !host.isEmpty,
      components.user == nil, components.password == nil,
      url.absoluteString.count <= 16_384,
      url.absoluteString.range(of: "%0[0ad]", options: .regularExpression.union(.caseInsensitive)) == nil else {
      throw SaveLinkError.invalidURL
    }
    var params: [String: AppIntentValue] = ["url": .string(url.absoluteString)]
    if let title = articleTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
      params["title"] = .string(String(title.prefix(512)))
    }
    await AppIntentDispatcher.shared.dispatch(name: "saveURL", params: params)
    return .result(dialog: "Open Slax Reader to review and save this link.")
  }
}

enum SaveLinkError: Error, CustomLocalizedStringResourceConvertible {
  case invalidURL
  var localizedStringResource: LocalizedStringResource { "Use an HTTP or HTTPS link without embedded credentials." }
}
