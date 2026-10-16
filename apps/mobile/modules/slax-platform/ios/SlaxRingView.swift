import ExpoModulesCore
import UIKit

private final class SlaxRingClock: NSObject {
  weak var owner: SlaxRingView?
  @objc func tick(_ link: CADisplayLink) { owner?.tick() }
}

/// Source CacheSizeRing and the pinned Material3 1.9.0 circular indicator geometry.
final class SlaxRingView: ExpoView {
  var segments = "[]"
  var thickness = 1.0
  var diameter = 24.0
  var track = "#E8E6E3"
  var geometry = "cache"
  var revealDuration = 0
  var indeterminate = false
  private struct Segment {let fraction: CGFloat; let color: UIColor}
  private var prepared: [Segment] = []
  private var fingerprint: String?
  private var revealStart: CFTimeInterval?
  private var motionStart: CFTimeInterval?
  private let trackLayer = CAShapeLayer()
  private var segmentLayers: [CAShapeLayer] = []
  private let clockTarget = SlaxRingClock()
  private var clock: CADisplayLink?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false; isUserInteractionEnabled = false; isAccessibilityElement = false
    layer.addSublayer(trackLayer); clockTarget.owner = self
  }
  override func layoutSubviews() {super.layoutSubviews(); paint()}
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {clock?.invalidate(); clock = nil; motionStart = nil}
    else {fingerprint = nil; update()}
  }
  deinit {clock?.invalidate()}

  func update() {
    let next = "\(segments)/\(revealDuration)/\(geometry)"
    if next != fingerprint {
      fingerprint = next
      let values = segments.data(using: .utf8).flatMap {try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]]} ?? []
      prepared = values.compactMap {value in
        guard let fraction = value["fraction"] as? NSNumber, let color = value["color"] as? String else {return nil}
        let amount = fraction.doubleValue
        return Segment(fraction: amount.isFinite ? CGFloat(min(max(amount, 0), 1)) : 0, color: ringColor(color))
      }
      segmentLayers.forEach {$0.removeFromSuperlayer()}
      segmentLayers = prepared.map {_ in let shape = CAShapeLayer(); layer.addSublayer(shape); return shape}
      revealStart = revealDuration > 0 && window != nil ? CACurrentMediaTime() : nil
    }
    if indeterminate && window != nil {if motionStart == nil {motionStart = CACurrentMediaTime()}}
    else {motionStart = nil}
    tick()
  }
  fileprivate func tick() {
    let now = CACurrentMediaTime()
    if let start = revealStart, now - start >= Double(max(revealDuration, 0)) / 1000 {revealStart = nil}
    let moving = window != nil && (revealStart != nil || motionStart != nil)
    if moving && clock == nil {let link = CADisplayLink(target: clockTarget, selector: #selector(SlaxRingClock.tick(_:))); link.add(to: .main, forMode: .common); clock = link}
    else if !moving {clock?.invalidate(); clock = nil}
    paint()
  }
  private func paint() {
    let size = CGFloat(max(diameter, 0)), stroke = CGFloat(max(thickness, 0))
    let radius = (size - (geometry == "material" ? stroke : 0)) / 2
    guard radius > 0, stroke > 0 else {trackLayer.path = nil; segmentLayers.forEach {$0.path = nil}; return}
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    let reveal = revealStart.map {bezier(CGFloat((CACurrentMediaTime() - $0) * 1000 / Double(max(revealDuration, 1))), 0.4, 0, 0.2, 1)} ?? 1
    CATransaction.begin(); CATransaction.setDisableActions(true); defer {CATransaction.commit()}
    let cap: CAShapeLayerLineCap = geometry == "material" ? .round : .butt
    ([trackLayer] + segmentLayers).forEach {$0.frame = bounds; $0.fillColor = nil; $0.lineWidth = stroke; $0.lineCap = cap}
    trackLayer.strokeColor = ringColor(track).cgColor
    func arc(_ shape: CAShapeLayer, _ start: CGFloat, _ sweep: CGFloat) {
      guard sweep > 0 else {shape.path = nil; return}
      let path = UIBezierPath(); path.addArc(withCenter: center, radius: radius, startAngle: start * .pi / 180, endAngle: (start + sweep) * .pi / 180, clockwise: true); shape.path = path.cgPath
    }
    if geometry == "material" {
      let phase = motionStart.map {CGFloat((CACurrentMediaTime() - $0).truncatingRemainder(dividingBy: 6) * 1000)} ?? 0
      let progress = motionStart == nil ? prepared.first?.fraction ?? 0 : phase <= 3000 ? 0.1 + 0.77 * phase / 3000 : 0.87 - 0.77 * bezier((phase - 3000) / 3000, 0.2, 0, 0, 1)
      let rotation = motionStart == nil ? -90 : phase * 1080 / 6000 + floor(phase / 1500) * 90 + min(phase.truncatingRemainder(dividingBy: 1500) / 300, 1) * 90
      let sweep = progress * 360, gap = min(sweep, (4 + stroke) / (.pi * size) * 360)
      arc(trackLayer, rotation + sweep + gap, 360 - sweep - gap * 2)
      for (index, shape) in segmentLayers.enumerated() {shape.strokeColor = prepared[index].color.cgColor; arc(shape, rotation, index == 0 ? sweep : 0)}
    } else {
      trackLayer.path = UIBezierPath(ovalIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)).cgPath
      var start: CGFloat = -90
      for (index, shape) in segmentLayers.enumerated() {
        let segment = prepared[index], sweep = segment.fraction * 360, gap = min(2, sweep / 4)
        shape.strokeColor = segment.color.cgColor; arc(shape, start + gap / 2, max(0, sweep - gap) * reveal); start += sweep
      }
    }
  }
  private func ringColor(_ value: String) -> UIColor {
    guard value.hasPrefix("#"), [7, 9].contains(value.count), let number = UInt64(value.dropFirst(), radix: 16) else {return .clear}
    let rgb = value.count == 9 ? number >> 8 : number, alpha = value.count == 9 ? number & 255 : 255
    return UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: CGFloat(alpha) / 255)
  }
  private func bezier(_ input: CGFloat, _ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) -> CGFloat {
    let x = min(max(input, 0), 1)
    func curve(_ t: CGFloat, _ a: CGFloat, _ b: CGFloat) -> CGFloat {let u = 1 - t; return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t}
    var low: CGFloat = 0, high: CGFloat = 1
    for _ in 0..<20 {let mid = (low + high) / 2; if curve(mid, x1, x2) < x {low = mid} else {high = mid}}
    return curve((low + high) / 2, y1, y2)
  }
}
