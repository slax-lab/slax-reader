import AppIntents
internal import ExpoAppIntents
internal import ExpoModulesCore

struct OpenBookmarkDonationIntent: AppIntent, DonatableAppIntent {
  static let title: LocalizedStringResource = "Open Saved Article"
  static let description = IntentDescription("Open a saved article in Slax Reader.")
  static let openAppWhenRun = true
  static let isDiscoverable = false

  @Parameter(title: "Bookmark ID") var bookmarkId: String

  struct DonationParams: Record {
    @Field(.required) var bookmarkId: String = ""
  }

  init() {
    bookmarkId = ""
  }

  init(donationParams: DonationParams) async throws {
    bookmarkId = donationParams.bookmarkId
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(
      name: "openBookmark",
      params: ["bookmarkId": .string(bookmarkId)]
    )
    return .result()
  }
}
