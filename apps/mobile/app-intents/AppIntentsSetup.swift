internal import ExpoAppIntents
internal import ExpoModulesCore

final class AppIntentsSetup: Module {
  public func definition() -> ExpoModulesCore.ModuleDefinition {
    Name("AppIntentsSetup")
    OnCreate {
      Task {
        await AppIntentDispatcher.shared.setShortcutsRefreshHandler {
          AppShortcuts.updateAppShortcutParameters()
        }
        if #available(iOS 18.0, *) {
          AppEntityIdentifierRegistry.shared.registerIndexed("bookmark", as: BookmarkEntity.self)
        }
        if #available(iOS 27.0, *) {
          AppIntentDonationRegistry.shared.register("openBookmark", as: OpenBookmarkDonationIntent.self)
        }
        AppShortcuts.updateAppShortcutParameters()
      }
    }
  }
}
