internal import ExpoAppIntents
internal import ExpoModulesCore

final class AppIntentsSetup: Module {
  public func definition() -> ExpoModulesCore.ModuleDefinition {
    Name("AppIntentsSetup")
    OnCreate {
      if #available(iOS 18.0, *) {
        AppEntityIdentifierRegistry.shared.registerIndexed("bookmark", as: BookmarkEntity.self)
      }
      AppIntentDonationRegistry.shared.register("openBookmark", as: OpenBookmarkDonationIntent.self)
      Task {
        await AppIntentDispatcher.shared.setShortcutsRefreshHandler {
          AppShortcuts.updateAppShortcutParameters()
        }
        AppShortcuts.updateAppShortcutParameters()
      }
    }
  }
}
