import AppIntents
@preconcurrency import CoreSpotlight
import Foundation
internal import ExpoAppIntents

struct BookmarkEntityQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [BookmarkEntity] {
    try await AppIntentEntityStore.shared
      .entities(ofKind: "bookmark", matching: identifiers)
      .map(BookmarkEntity.init(record:))
  }

  func suggestedEntities() async throws -> [BookmarkEntity] {
    try await AppIntentEntityStore.shared.entities(ofKind: "bookmark")
      .map(BookmarkEntity.init(record:))
  }

  func entities(matching string: String) async throws -> [BookmarkEntity] {
    let search = string.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !search.isEmpty else { return try await suggestedEntities() }

    return try await suggestedEntities().filter { bookmark in
      [bookmark.title, bookmark.sourceHost ?? ""].contains { value in
        value.range(of: search, options: [.caseInsensitive, .diacriticInsensitive]) != nil
      }
    }
  }
}

@available(iOS 18.0, macOS 15.0, *)
extension BookmarkEntityQuery: EnumerableEntityQuery {
  func allEntities() async throws -> [BookmarkEntity] {
    try await AppIntentEntityStore.shared.entities(ofKind: "bookmark")
      .map(BookmarkEntity.init(record:))
  }
}

#if compiler(>=6.4)
@available(iOS 27.0, macOS 27.0, *)
extension BookmarkEntityQuery: IndexedEntityQuery {
  func reindexEntities(
    for identifiers: [BookmarkEntity.ID],
    indexDescription: CSSearchableIndexDescription
  ) async throws {
    try await AppEntityIdentifierRegistry.shared.updateIndexFromCatalog(
      kind: "bookmark",
      matching: identifiers
    )
  }

  func reindexAllEntities(indexDescription: CSSearchableIndexDescription) async throws {
    try await AppEntityIdentifierRegistry.shared.replaceIndexFromCatalog(kind: "bookmark")
  }
}
#endif
