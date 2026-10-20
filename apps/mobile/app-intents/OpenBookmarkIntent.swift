import AppIntents
internal import ExpoAppIntents

struct OpenBookmarkIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Saved Article"
  static let description = IntentDescription("Open a saved article in Slax Reader.")
  static let openAppWhenRun = true

  @Parameter(title: "Article") var target: BookmarkEntity

  static var parameterSummary: some ParameterSummary {
    Summary("Open \(\.$target)")
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(
      name: "openBookmark",
      params: ["bookmarkId": .string(target.id)]
    )
    return .result()
  }
}
