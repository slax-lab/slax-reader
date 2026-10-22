import AppIntents
@preconcurrency import CoreSpotlight
import Foundation
internal import ExpoAppIntents

enum BookmarkPredicate: Sendable {
  case titleEquals(String)
  case titleContains(String)
  case titleHasPrefix(String)
  case sourceEquals(String)
  case sourceContains(String)
  case sourceHasPrefix(String)

  private static func normalizedContains(_ value: String, _ search: String) -> Bool {
    !search.isEmpty && value.localizedStandardContains(search)
  }

  private static func normalizedEquals(_ value: String, _ search: String) -> Bool {
    value.compare(search, options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive]) == .orderedSame
  }

  private static func normalizedPrefix(_ value: String, _ search: String) -> Bool {
    !search.isEmpty && value.range(of: search, options: [.anchored, .caseInsensitive, .diacriticInsensitive, .widthInsensitive]) != nil
  }

  func matches(_ bookmark: BookmarkEntity) -> Bool {
    switch self {
    case .titleEquals(let value): return Self.normalizedEquals(bookmark.title, value)
    case .titleContains(let value): return Self.normalizedContains(bookmark.title, value)
    case .titleHasPrefix(let value): return Self.normalizedPrefix(bookmark.title, value)
    case .sourceEquals(let value): return Self.normalizedEquals(bookmark.sourceHost, value)
    case .sourceContains(let value): return Self.normalizedContains(bookmark.sourceHost, value)
    case .sourceHasPrefix(let value): return Self.normalizedPrefix(bookmark.sourceHost, value)
    }
  }
}

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
      bookmark.title.localizedStandardContains(search) || bookmark.sourceHost.localizedStandardContains(search)
    }
  }
}

extension BookmarkEntityQuery: EntityPropertyQuery {
  typealias ComparatorMappingType = BookmarkPredicate

  @available(iOS 17.0, macOS 14.0, *)
  static var findIntentDescription: IntentDescription? {
    IntentDescription("Find saved articles in Slax Reader.")
  }

  static var properties = QueryProperties {
    Property(\.$title) {
      EqualToComparator { BookmarkPredicate.titleEquals($0) }
      ContainsComparator { BookmarkPredicate.titleContains($0) }
      HasPrefixComparator { BookmarkPredicate.titleHasPrefix($0) }
    }
    Property(\.$sourceHost) {
      EqualToComparator { BookmarkPredicate.sourceEquals($0) }
      ContainsComparator { BookmarkPredicate.sourceContains($0) }
      HasPrefixComparator { BookmarkPredicate.sourceHasPrefix($0) }
    }
  }

  static var sortingOptions = SortingOptions {
    SortableBy(\.$title)
  }

  func entities(
    matching comparators: [BookmarkPredicate],
    mode: ComparatorMode,
    sortedBy: [Sort<BookmarkEntity>],
    limit: Int?
  ) async throws -> [BookmarkEntity] {
    var values = try await suggestedEntities()
    if !comparators.isEmpty {
      values = values.filter { bookmark in
        mode == .and
          ? comparators.allSatisfy { $0.matches(bookmark) }
          : comparators.contains { $0.matches(bookmark) }
      }
    }
    let titleKey: PartialKeyPath<BookmarkEntity> = \BookmarkEntity.$title
    for sort in sortedBy.reversed() where sort.by == titleKey {
      values.sort { left, right in
        let order = left.title.localizedStandardCompare(right.title)
        return sort.order == .ascending ? order == .orderedAscending : order == .orderedDescending
      }
    }
    if let limit, limit >= 0 { values = Array(values.prefix(limit)) }
    return values
  }
}

@available(iOS 17.0, macOS 14.0, *)
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
