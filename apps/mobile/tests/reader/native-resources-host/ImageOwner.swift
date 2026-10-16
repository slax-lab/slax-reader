enum SlaxReaderView {
  static var activeOwner: String? = "synthetic-owner"
  static func owns(_ owner: String) -> Bool { activeOwner == owner }
}
