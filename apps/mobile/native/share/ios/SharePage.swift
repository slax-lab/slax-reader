import Foundation
import UniformTypeIdentifiers

struct SharePage {
    static let propertyListIdentifier = UTType.propertyList.identifier
    let title: String?
    let url: String?

    init(results: [String: Any]) {
        title = results["title"] as? String
        if let value = results["url"] as? String,
           let parsed = URL(string: value),
           ["http", "https"].contains(parsed.scheme?.lowercased() ?? ""),
           let host = parsed.host, !host.isEmpty {
            url = value
        } else {
            url = nil
        }
    }
}
