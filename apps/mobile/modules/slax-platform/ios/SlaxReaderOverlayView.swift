import ExpoModulesCore
import UIKit

final class SlaxReaderOverlayView: ExpoView {
  private static let overlays = NSHashTable<SlaxReaderOverlayView>.weakObjects()
  var pageId = ""
  var overlayKind = "header"
  var topInsetPoints: Double = 0
  var headerHeightPoints: Double = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    Self.overlays.add(self)
  }
  override func didMoveToSuperview() { super.didMoveToSuperview(); update() }
  override func layoutSubviews() { super.layoutSubviews(); update() }
  func update() {
    guard let reader = SlaxReaderView.activeReader(pageId: pageId) else { return }
    apply(reader.webView.scrollView)
  }
  static func update(pageId: String, scrollView: UIScrollView) {
    for overlay in overlays.allObjects where overlay.pageId == pageId { overlay.apply(scrollView) }
  }
  private func apply(_ scrollView: UIScrollView) {
    let offset = max(scrollView.contentOffset.y + topInsetPoints, 0)
    let header = overlayKind == "header"
    let visible = !header || headerHeightPoints == 0 || scrollView.contentOffset.y + topInsetPoints < headerHeightPoints
    transform = CGAffineTransform(translationX: 0, y: header ? -offset : scrollView.contentSize.height + topInsetPoints - offset)
    alpha = visible ? 1 : 0
    isUserInteractionEnabled = visible
    accessibilityElementsHidden = !visible
  }
}
