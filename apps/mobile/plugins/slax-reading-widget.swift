import Foundation
import SwiftUI
import WidgetKit

private struct SlaxWidgetSuggestion: Decodable {
  let id: String
  let title: String?
}

private struct SlaxWidgetSnapshot: Decodable {
  let version: Int
  let state: String
  let updatedAt: Double?
  let unreadCount: Int?
  let suggestions: [SlaxWidgetSuggestion]

  static func load() -> SlaxWidgetSnapshot {
    let defaults = UserDefaults(suiteName: "group.app.slax.reader")
    let committedVersion = defaults?.integer(forKey: "slax-widget-committed-version-v1") ?? 0
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.slax.reader"),
      let data = try? Data(contentsOf: container.appendingPathComponent("slax-widget-snapshot-v1.json")),
      let snapshot = try? JSONDecoder().decode(SlaxWidgetSnapshot.self, from: data),
      snapshot.version == committedVersion else {
      return SlaxWidgetSnapshot(version: committedVersion, state: "neutral", updatedAt: nil, unreadCount: nil, suggestions: [])
    }
    return snapshot
  }
}

private struct SlaxWidgetEntry: TimelineEntry {
  let date: Date
  let snapshot: SlaxWidgetSnapshot
}

private struct SlaxWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> SlaxWidgetEntry {
    SlaxWidgetEntry(date: Date(), snapshot: SlaxWidgetSnapshot(version: 0, state: "neutral", updatedAt: nil, unreadCount: nil, suggestions: []))
  }
  func getSnapshot(in context: Context, completion: @escaping (SlaxWidgetEntry) -> Void) {
    completion(SlaxWidgetEntry(date: Date(), snapshot: .load()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<SlaxWidgetEntry>) -> Void) {
    completion(Timeline(entries: [SlaxWidgetEntry(date: Date(), snapshot: .load())], policy: .never))
  }
}

private struct SlaxWidgetView: View {
  let snapshot: SlaxWidgetSnapshot
  @Environment(\.widgetFamily) private var family

  private var message: String {
    switch snapshot.state {
    case "signedOut": return "Sign in to see your reading list"
    case "neutral": return "Enable widget details in Slax Reader"
    case "empty": return "Nothing unread right now"
    default: return snapshot.suggestions.isEmpty ? "Your reading list is ready" : "Recently saved"
    }
  }

  private var content: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        Text("Slax Reader").font(.headline).lineLimit(1)
        Spacer(minLength: 4)
        if let count = snapshot.unreadCount { Text("\(count) unread").font(.caption).bold() }
      }
      Text(message).font(.caption).foregroundStyle(.secondary).lineLimit(2)
      if snapshot.state == "ready" {
        ForEach(snapshot.suggestions.prefix(family == .systemSmall ? 1 : 3), id: \.id) { item in
          if let title = item.title, let url = Self.bookmarkURL(item.id) {
            Link(destination: url) { Text(title).font(.subheadline).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading) }
          }
        }
      }
      Spacer(minLength: 0)
      Text(updatedLabel).font(.caption2).foregroundStyle(.tertiary).frame(maxWidth: .infinity, alignment: .trailing)
    }
    .padding()
    .widgetURL(URL(string: "slaxreader://widget"))
  }

  @ViewBuilder var body: some View {
    if #available(iOS 17.0, *) { content.containerBackground(.background, for: .widget) }
    else { content.background(Color(.systemBackground)) }
  }

  private static func bookmarkURL(_ id: String) -> URL? {
    var components = URLComponents(string: "slaxreader://widget")
    components?.queryItems = [URLQueryItem(name: "bookmarkId", value: id)]
    return components?.url
  }

  private var updatedLabel: String {
    guard let timestamp = snapshot.updatedAt else { return "Open Slax Reader" }
    return "Updated \(Date(timeIntervalSince1970: timestamp / 1000).formatted(date: .omitted, time: .shortened))"
  }
}

struct SlaxReadingWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SlaxReadingWidget", provider: SlaxWidgetProvider()) { entry in
      SlaxWidgetView(snapshot: entry.snapshot)
    }
    .configurationDisplayName("Slax Reading List")
    .description("A compact view of your opted-in unread reading list.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
