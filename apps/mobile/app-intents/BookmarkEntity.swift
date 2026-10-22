import AppIntents
@preconcurrency import CoreSpotlight
import Foundation
internal import ExpoAppIntents

struct BookmarkEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Saved article"
  static let defaultQuery = BookmarkEntityQuery()

  var id: String
  @Property(title: "Title") var title: String
  @Property(title: "Source") var sourceHost: String

  init(record: AppIntentEntityRecord) {
    id = record.id
    title = record.title
    sourceHost = record.metadata["sourceHost"] ?? record.subtitle ?? ""
  }

  var displayRepresentation: DisplayRepresentation {
    if !sourceHost.isEmpty {
      return DisplayRepresentation(title: "\(title)", subtitle: "\(sourceHost)")
    }
    return DisplayRepresentation(title: "\(title)")
  }
}

extension BookmarkEntity: AppIntentEntityRecordConvertible {}

@available(iOS 18.0, macOS 15.0, *)
@available(tvOS, unavailable)
extension BookmarkEntity: IndexedEntity {
  static let spotlightDomainIdentifier = "app.slax.reader.bookmark"

  var attributeSet: CSSearchableItemAttributeSet {
    let attributes = CSSearchableItemAttributeSet(contentType: .text)
    attributes.title = title
    attributes.displayName = title
    attributes.subject = sourceHost.isEmpty ? nil : sourceHost
    attributes.domainIdentifier = Self.spotlightDomainIdentifier
    attributes.keywords = ["Slax Reader"] + (sourceHost.isEmpty ? [] : [sourceHost])
    return attributes
  }
}
