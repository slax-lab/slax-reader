import AppIntents

struct AppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: SaveLinkIntent(), phrases: [
      "Save a link in \(.applicationName)",
      "Save to \(.applicationName)"
    ], shortTitle: "Save link", systemImageName: "bookmark")
  }
}
