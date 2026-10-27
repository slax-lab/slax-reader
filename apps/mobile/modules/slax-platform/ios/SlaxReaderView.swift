import ExpoModulesCore
import WebKit
import UIKit

private final class SlaxNoMenuWebView: WKWebView {
  var onTouch: ((CGFloat) -> Void)?
  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool { false }
  override func buildMenu(with builder: UIMenuBuilder) {
    super.buildMenu(with: builder)
    guard builder.system === UIMenuSystem.context else { return }
    builder.replaceChildren(ofMenu: .root) { _ in [] }
  }
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if event != nil { onTouch?(convert(point, to: nil).y) }
    return super.hitTest(point, with: event)
  }
}
private final class SlaxWeakMessage: NSObject, WKScriptMessageHandler {
  weak var owner: SlaxReaderView?
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, message.name == "slaxReader", let raw = message.body as? String,
      raw.utf16.count <= 8 * 1024 * 1024 else { return }
    owner?.receiveMessage(raw)
  }
}
private final class SlaxWeakSourceMessage: NSObject, WKScriptMessageHandler {
  weak var owner: SlaxReaderView?
  private var binding: (pageId: String, generation: String)?
  func bind(pageId: String, generation: String) { if binding == nil { binding = (pageId, generation) } }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, message.name == "NativeBridge", let raw = message.body as? String,
      raw.utf16.count <= 8 * 1024 * 1024, let binding else { return }
    owner?.receiveSourceMessage(raw, pageId: binding.pageId, generation: binding.generation)
  }
}
private enum SlaxReaderRuleLists {
  private static let cache: NSCache<NSString, WKContentRuleList> = {
    let cache = NSCache<NSString, WKContentRuleList>()
    cache.countLimit = 4
    return cache
  }()
  private static var pending: [String: [(WKContentRuleList?, Error?) -> Void]] = [:]
  private static var pruned = false
  // Bump whenever SlaxReaderSecurity.contentRules() changes its output for the same policy.
  private static let rulesVersion = "r1"
  // Compiled lists persist across launches, named by rules version, build and policy identity. A new build
  // or rules version gets a new prefix, so a stale list is never reused; other prefixes are pruned once.
  private static let prefix: String = {
    let info = Bundle.main.infoDictionary
    let build = "\(info?["CFBundleShortVersionString"] as? String ?? "0")-\(info?["CFBundleVersion"] as? String ?? "0")"
    return "slax-reader-rules-\(rulesVersion)-\(sanitized(build))-"
  }()
  private static func sanitized(_ value: String) -> String { value.replacingOccurrences(of: "[^A-Za-z0-9.-]", with: "_", options: .regularExpression) }
  private static func ruleListName(_ security: SlaxReaderSecurity) -> String {
    prefix + (security.pdfMode ? "pdf" : "article-" + sanitized(security.protectedHosts.joined(separator: "_")))
  }

  static func load(_ rules: String, for security: SlaxReaderSecurity, completion: @escaping (WKContentRuleList?, Error?) -> Void) {
    if let cached = cache.object(forKey: rules as NSString) { completion(cached, nil); return }
    if pending[rules] != nil { pending[rules]?.append(completion); return }
    pending[rules] = [completion]
    let name = ruleListName(security)
    let store: WKContentRuleListStore = WKContentRuleListStore.default()
    let finish: (WKContentRuleList?, Error?) -> Void = { list, error in
      DispatchQueue.main.async {
        if let list, error == nil { cache.setObject(list, forKey: rules as NSString) }
        let callbacks = pending.removeValue(forKey: rules) ?? []
        callbacks.forEach { $0(list, error) }
        pruneOtherBuilds(store)
      }
    }
    store.lookUpContentRuleList(forIdentifier: name) { stored, _ in
      if let stored { finish(stored, nil); return }
      store.compileContentRuleList(forIdentifier: name, encodedContentRuleList: rules, completionHandler: finish)
    }
  }
  private static func pruneOtherBuilds(_ store: WKContentRuleListStore) {
    guard !pruned else { return }
    pruned = true
    store.getAvailableContentRuleListIdentifiers { identifiers in
      for stale in identifiers ?? [] where stale.hasPrefix("slax-reader-") && !stale.hasPrefix(prefix) {
        store.removeContentRuleList(forIdentifier: stale) { _ in }
      }
    }
  }
}
/// One-time warmup before the first Reader opens. The discarded web view only starts WebKit processes; documents always get their own view.
enum SlaxReaderPrewarm {
  private static var started = false
  private static var warmView: WKWebView?
  static func run(protectedHosts: [String], imageProxyOrigins: [String]) {
    guard !started else { return }
    started = true
    if let security = try? SlaxReaderSecurity(protectedHosts, imageProxyOrigins: imageProxyOrigins), let rules = try? security.contentRules() {
      SlaxReaderRuleLists.load(rules, for: security) { _, _ in }
    }
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = []
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.loadHTMLString("<!doctype html><html><body></body></html>", baseURL: nil)
    warmView = view
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { warmView?.stopLoading(); warmView = nil }
  }
}
final class SlaxReaderView: ExpoView, WKNavigationDelegate, WKUIDelegate, UIScrollViewDelegate {
  private static var sequence = 0
  // WebKit callbacks, view disposal, and account revocation share the main queue.
  private static let activeViews = NSHashTable<SlaxReaderView>.weakObjects()
  private static var activeOwner: String?
  static func activeReader(pageId: String) -> SlaxReaderView? { activeViews.allObjects.first { !$0.detached && $0.pageId == pageId } }
  static func owns(_ owner: String) -> Bool { activeOwner == owner }
  static func currentOwner() -> String? { activeOwner }
  static func revokeAllResources() { try? SlaxStorageOwner.activate(nil); SlaxPdfTransfers.revokeAll(); SlaxImageModule.revokeAll(); activeOwner = nil; activeViews.allObjects.forEach { $0.detach() } }
  static func activateResources(_ owner: String) throws {
    guard owner.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { throw NSError(domain: "SlaxPlatform", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid Reader owner"]) }
    if activeOwner != nil, activeOwner != owner { revokeAllResources() }
    if activeOwner != owner { try SlaxStorageOwner.activate(owner) }
    activeOwner = owner
  }
  let onEvent = EventDispatcher()
  let resources: SlaxResourceHandler
  private let message: SlaxWeakMessage
  private let sourceMessage: SlaxWeakSourceMessage
  let webView: WKWebView
  private let identifier: Int
  var html = ""; var pageId = ""
  private var pdfMode = false
  func setPdfMode(_ value: Bool) {
    if pdfMode != value && (loaded != nil || security != nil) { detach(); return }
    pdfMode = value
  }
  private var security: SlaxReaderSecurity?
  private var rulesReady = false
  private var rulesCompiling = false
  private var protectedHosts: [String]?
  var imageProxyOrigins: [String]? { didSet { if oldValue != nil && oldValue != imageProxyOrigins { detach() } } }
  func setProtectedHosts(_ hosts: [String]) {
    if protectedHosts != nil && protectedHosts != hosts { detach(); return }
    protectedHosts = hosts
  }
  var resourceOwner: String? { didSet { if oldValue != nil, oldValue != resourceOwner { detach() }; resources.resourceOwner = resourceOwner } }
  private var ownsResources: Bool { !detached && !processGone && (resources.isFixture || resourceOwner != nil && resourceOwner == Self.activeOwner) }
  private var loaded: String?; private var detached = false; private var initializedInsets = false
  private var loadedPageId: String?; private var loadedGeneration: String?
  private var documentNavigation: WKNavigation?
  private var navigationGate = SlaxReaderDocumentNavigationGate()
  private var evaluations: [UUID: (promise: Promise, timeout: DispatchWorkItem)] = [:]
  private var loadedOwner: String?
  private var applicationActive = UIApplication.shared.applicationState == .active
  private var processGone = false
  private var pendingSourceReady: (raw: String, pageId: String, generation: String)?
  private var contentSizeObservation: NSKeyValueObservation?

  private var permitsEvaluation: Bool { !processGone && ownsResources && navigationGate.permitsSource && loaded == html && loadedPageId == pageId && loadedOwner == resourceOwner }
  fileprivate func receiveMessage(_ raw: String) {
    guard permitsEvaluation else { return }
    emit("message", ["data": raw])
  }
  func injectJavaScript(_ script: String) {
    guard applicationActive, permitsEvaluation else { return }
    webView.evaluateJavaScript(script, completionHandler: nil)
  }
  func evaluateJavaScript(_ script: String, pageId: String, promise: Promise) {
    guard !processGone else { promise.reject("E_READER_PROCESS_GONE", "Reader document process was interrupted"); return }
    guard applicationActive else { promise.reject("E_READER_INACTIVE", "Reader operation cancelled while inactive"); return }
    guard permitsEvaluation, pageId == loadedPageId, let generation = loadedGeneration else {
      promise.reject("E_READER_RELEASED", "Reader page was released")
      return
    }
    let id = UUID()
    let timeout = DispatchWorkItem { [weak self] in
      self?.evaluations.removeValue(forKey: id)?.promise.reject("E_READER_TIMEOUT", "Reader native evaluation timed out")
    }
    evaluations[id] = (promise, timeout)
    DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
    webView.evaluateJavaScript(script) { [weak self] value, error in
      guard let self, let pending = self.evaluations.removeValue(forKey: id) else { return }
      pending.timeout.cancel()
      guard self.applicationActive else { pending.promise.reject("E_READER_INACTIVE", "Reader operation cancelled while inactive"); return }
      guard self.permitsEvaluation, self.loadedGeneration == generation, self.loadedPageId == pageId else {
        pending.promise.reject("E_READER_RELEASED", "Reader page was released")
        return
      }
      if let error = error as NSError? {
        if error.domain == WKError.errorDomain && error.code == WKError.webContentProcessTerminated.rawValue {
          self.markProcessGone()
          pending.promise.reject("E_READER_PROCESS_GONE", "Reader document process was interrupted")
        } else { pending.promise.reject("E_READER_EVALUATION", "Reader native evaluation failed") }
      } else { pending.promise.resolve(value) }
    }
  }
  private func cancelEvaluations(_ code: String = "E_READER_RELEASED") {
    let pending = evaluations.values
    evaluations.removeAll()
    pending.forEach { $0.timeout.cancel(); $0.promise.reject(code, code == "E_READER_INACTIVE" ? "Reader operation cancelled while inactive" : "Reader page was released") }
  }
  @objc private func suspendDocument() {
    applicationActive = false
    cancelEvaluations("E_READER_INACTIVE")
  }
  @objc private func resumeDocument() {
    applicationActive = true
    guard !detached, !processGone else { return }
    loadPendingDocument()
    if let pending = pendingSourceReady {
      pendingSourceReady = nil
      receiveSourceMessage(pending.raw, pageId: pending.pageId, generation: pending.generation)
    }
  }
  private func markProcessGone() {
    guard !detached, !processGone else { return }
    processGone = true
    navigationGate.invalidate()
    loadedGeneration = nil
    pendingSourceReady = nil
    cancelEvaluations("E_READER_INACTIVE")
    resources.cancelAll()
    emit("error", ["message": "Reader process interrupted", "code": "renderProcessGone"])
  }

  required init(appContext: AppContext? = nil) {
    Self.sequence += 1; identifier = Self.sequence
    let resources = SlaxResourceHandler()
    let message = SlaxWeakMessage()
    let sourceMessage = SlaxWeakSourceMessage()
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = []
    // The handlers and subclass must be installed before WKWebView construction.
    configuration.setURLSchemeHandler(resources, forURLScheme: "slaxstatic")
    configuration.setURLSchemeHandler(resources, forURLScheme: "slaxstatics")
    configuration.setURLSchemeHandler(resources, forURLScheme: "slaxmedia")
    configuration.setURLSchemeHandler(resources, forURLScheme: "slaxmedias")
    configuration.userContentController.add(message, name: "slaxReader")
    configuration.userContentController.add(sourceMessage, name: "NativeBridge")
    configuration.userContentController.addUserScript(WKUserScript(source: "window.ReactNativeWebView={postMessage:function(data){window.webkit.messageHandlers.slaxReader.postMessage(String(data));}};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    webView = SlaxNoMenuWebView(frame: .zero, configuration: configuration)
    self.resources = resources; self.message = message; self.sourceMessage = sourceMessage
    super.init(appContext: appContext)
    Self.activeViews.add(self)
    resources.hasResourceOwnership = { [weak self] in self?.ownsResources == true }
    message.owner = self
    sourceMessage.owner = self
    webView.navigationDelegate = self; webView.uiDelegate = self; webView.scrollView.delegate = self
    webView.isOpaque = false; webView.backgroundColor = .clear; webView.scrollView.backgroundColor = .clear
    webView.scrollView.showsVerticalScrollIndicator = false; webView.scrollView.showsHorizontalScrollIndicator = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    // The Reader draws its own transparent top bar; iOS 26 must not add its automatic scroll-edge blur band at any edge.
    #if compiler(>=6.2)
    if #available(iOS 26, *) {
      for effect in [webView.scrollView.topEdgeEffect, webView.scrollView.bottomEdgeEffect, webView.scrollView.leftEdgeEffect, webView.scrollView.rightEdgeEffect] { effect.isHidden = true }
    }
    #endif
    (webView as? SlaxNoMenuWebView)?.onTouch = { [weak self] y in self?.emit("touch", ["screenY": y]) }
    addSubview(webView)
    NotificationCenter.default.addObserver(self, selector: #selector(suspendDocument), name: UIApplication.willResignActiveNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(resumeDocument), name: UIApplication.didBecomeActiveNotification, object: nil)
    contentSizeObservation = webView.scrollView.observe(\.contentSize) { [weak self] scrollView, _ in
      guard let self, !self.detached else { return }
      SlaxReaderOverlayView.update(pageId: self.pageId, scrollView: scrollView)
    }
  }
  deinit { NotificationCenter.default.removeObserver(self) }
  override func layoutSubviews() {
    super.layoutSubviews(); webView.frame = bounds
    SlaxReaderOverlayView.update(pageId: pageId, scrollView: webView.scrollView)
  }
  func setFixtureDirectory(_ directory: URL?) {
    do { try resources.setFixtureDirectory(directory) }
    catch {
      emit("error", ["message": "Invalid controlled Reader cache directory", "code": "fixtureDirectory"])
      detach()
    }
  }
  func emit(_ type: String, _ fields: [String: Any] = [:]) {
    guard !detached else { return }
    onEvent(fields.merging(["type": type, "target": identifier, "pageId": pageId], uniquingKeysWith: { _, new in new }))
  }
  func loadPendingDocument() {
    guard applicationActive, !processGone else { return }
    guard ownsResources, let protectedHosts, let imageProxyOrigins, !html.isEmpty, !pageId.isEmpty else { return }
    guard let policy = try? SlaxReaderSecurity(protectedHosts, imageProxyOrigins: imageProxyOrigins, pdfMode: pdfMode) else { detach(); return }
    if let security, security != policy { detach(); return }
    security = policy; resources.security = policy
    let security = policy
    if !rulesReady {
      guard !rulesCompiling else { return }
      rulesCompiling = true
      let expectedPage = pageId, expectedOwner = resourceOwner
      guard let rules = try? security.contentRules() else { detach(); return }
      SlaxReaderRuleLists.load(rules, for: security) { [weak self] list, error in
        guard let self, self.ownsResources, self.pageId == expectedPage, self.resourceOwner == expectedOwner, self.security == security else { return }
        guard let list, error == nil else { self.emit("error", ["message": "Reader security policy unavailable", "code": "securityPolicy"]); self.detach(); return }
        self.webView.configuration.userContentController.add(list)
        self.rulesReady = true
        self.loadPendingDocument()
      }
      return
    }
    if let loaded {
      // ReaderPage already remounts on document changes. Never bind an old raw
      // source callback to a later document in the same native WKWebView.
      if loaded != html || loadedPageId != pageId {
        emit("error", ["message": "Reader document requires a new native page", "code": "documentReuse"])
        detach()
      }
      return
    }
    let generation = UUID().uuidString
    loaded = html; loadedPageId = pageId; loadedGeneration = generation; loadedOwner = resourceOwner
    sourceMessage.bind(pageId: pageId, generation: generation)
    resources.cancelAll()
    var document: String
    if pdfMode {
      guard let pdfDocument = try? SlaxReaderSecurity.pdfDocument(html, pageId: pageId) else { detach(); return }
      document = pdfDocument
    } else { document = SlaxReaderSecurity.document(html) }
    if resources.isFixture && !pdfMode {
      // This policy is inserted before any source resource can load, and remains
      // active even if a script later removes its meta element.
      let policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: slaxstatic: slaxstatics:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'\">"
      if let head = document.range(of: "(?i)<head(?:\\s[^>]*)?>", options: .regularExpression) { document.insert(contentsOf: policy, at: head.upperBound) }
      else { document = policy + document }
    }
    documentNavigation = webView.loadHTMLString(document, baseURL: security.documentOrigin)
  }
  fileprivate func receiveSourceMessage(_ raw: String, pageId: String, generation: String) {
    guard Thread.isMainThread, ownsResources, navigationGate.permitsSource, loadedPageId == pageId, self.pageId == pageId,
      loadedGeneration == generation, loaded == html,
      let data = try? JSONSerialization.data(withJSONObject: [raw, pageId]),
      let arguments = String(data: data, encoding: .utf8) else { return }
    guard applicationActive else {
      if let source = raw.data(using: .utf8), let payload = try? JSONSerialization.jsonObject(with: source) as? [String: Any], payload["type"] as? String == "domReady" {
        pendingSourceReady = (raw, pageId, generation)
      }
      return
    }
    // The existing host supplies geometry, counters and the RN page envelope.
    // JSON serialization embeds arguments without executing article contents.
    webView.evaluateJavaScript("window.__SlaxReaderHost && window.__SlaxReaderHost.receiveSourceMessage.apply(null, \(arguments));", completionHandler: { _, _ in })
  }
  // A header change keeps the adjusted document offset. During a drag or fling the correction waits for the
  // gesture to end, because setContentOffset would stop deceleration and move the text under the finger.
  private var pendingOffsetCorrection: CGFloat = 0
  private var scrollGestureActive: Bool {
    let scrollView = webView.scrollView
    return scrollView.isTracking || scrollView.isDragging || scrollView.isDecelerating
  }
  func updateInsets(top: Double, bottom: Double) {
    let scrollView = webView.scrollView
    let insets = UIEdgeInsets(top: top, left: 0, bottom: bottom, right: 0)
    guard !initializedInsets || scrollView.contentInset != insets else { return }
    let previousTop = scrollView.contentInset.top
    scrollView.contentInset = insets
    guard initializedInsets else {
      initializedInsets = true
      scrollView.setContentOffset(CGPoint(x: 0, y: -top), animated: false)
      return
    }
    pendingOffsetCorrection += previousTop - CGFloat(top)
    if !scrollGestureActive { applyPendingOffsetCorrection(afterGesture: false) }
  }
  private func applyPendingOffsetCorrection(afterGesture: Bool) {
    let correction = pendingOffsetCorrection
    pendingOffsetCorrection = 0
    guard correction != 0, !detached else { return }
    let scrollView = webView.scrollView
    let y = scrollView.contentOffset.y + correction
    guard afterGesture else { scrollView.setContentOffset(CGPoint(x: 0, y: y), animated: false); return }
    // A gesture that ended against the top already bounced onto the new inset; shifting it would hide part of the header.
    let top = -scrollView.contentInset.top
    guard scrollView.contentOffset.y > top else { return }
    let bottom = max(top, scrollView.contentSize.height + scrollView.contentInset.bottom - scrollView.bounds.height)
    scrollView.setContentOffset(CGPoint(x: 0, y: min(max(y, top), bottom)), animated: false)
  }
  func detach() { guard !detached else { return }; detached = true; trailingScroll?.cancel(); trailingScroll = nil; navigationGate.invalidate(); loadedGeneration = nil; cancelEvaluations(); pendingSourceReady = nil; contentSizeObservation = nil; NotificationCenter.default.removeObserver(self); Self.activeViews.remove(self); resources.close(); webView.stopLoading(); webView.configuration.userContentController.removeScriptMessageHandler(forName: "slaxReader"); webView.configuration.userContentController.removeScriptMessageHandler(forName: "NativeBridge"); webView.navigationDelegate = nil; webView.uiDelegate = nil; webView.scrollView.delegate = nil }
  private func unexpectedNavigation() {
    guard !processGone else { return }
    emit("error", ["message": "Reader document navigation was rejected", "code": "documentNavigation"])
    detach()
  }
  private func navigationFailed(_ error: Error) {
    guard !processGone, !detached else { return }
    let failure = error as NSError
    if failure.domain == WKError.errorDomain && failure.code == WKError.webContentProcessTerminated.rawValue { markProcessGone(); return }
    emit("error", ["message": error.localizedDescription])
    detach()
  }
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    guard let navigation, let documentNavigation,
      navigationGate.start(isExpectedNavigation: navigation === documentNavigation) else { unexpectedNavigation(); return }
    emit("loadStart")
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard let navigation, let documentNavigation,
      navigationGate.finish(isExpectedNavigation: navigation === documentNavigation) else { unexpectedNavigation(); return }
    emit("loadEnd")
  }
  func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) { unexpectedNavigation() }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { markProcessGone() }
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard ownsResources, rulesReady, let security, let url = action.request.url else { decisionHandler(.cancel); return }
    if navigationGate.admitMainFrame(isInitialRequest: loaded != nil && (url == security.documentOrigin || url.absoluteString == "about:blank") && action.targetFrame?.isMainFrame == true && action.navigationType == .other) {
      decisionHandler(.allow); return
    }
    guard !resources.isFixture, security.allows(url) else { decisionHandler(.cancel); return }
    if action.targetFrame?.isMainFrame == false { decisionHandler(url.scheme == "https" ? .allow : .cancel); return }
    if action.navigationType == .linkActivated { emit("external", ["url": url.absoluteString]) }
    decisionHandler(.cancel)
  }
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    guard ownsResources, rulesReady, !resources.isFixture, let security, let url = action.request.url,
      security.allows(url), action.navigationType == .linkActivated else { return nil }
    emit("external", ["url": url.absoluteString]); return nil
  }
  // Native overlays follow every frame. Article JS only needs sampled metrics during a user drag or
  // fling plus the exact settled offset; PDF virtualization and programmatic scrolls stay per frame.
  private static let userScrollSampleInterval: CFTimeInterval = 0.05
  private var lastScrollEmit: CFTimeInterval = 0
  private var trailingScroll: DispatchWorkItem?
  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    guard !detached, !processGone else { return }
    SlaxReaderOverlayView.update(pageId: pageId, scrollView: scrollView)
    guard !pdfMode, scrollView.isDragging || scrollView.isDecelerating else { emitScroll(scrollView); return }
    let elapsed = CACurrentMediaTime() - lastScrollEmit
    if elapsed >= Self.userScrollSampleInterval { emitScroll(scrollView); return }
    guard trailingScroll == nil else { return }
    let work = DispatchWorkItem { [weak self, weak scrollView] in
      guard let self, let scrollView else { return }
      self.trailingScroll = nil
      self.emitScroll(scrollView)
    }
    trailingScroll = work
    DispatchQueue.main.asyncAfter(deadline: .now() + (Self.userScrollSampleInterval - elapsed), execute: work)
  }
  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    guard !decelerate else { return }
    applyPendingOffsetCorrection(afterGesture: true)
    emitScroll(scrollView)
  }
  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { applyPendingOffsetCorrection(afterGesture: true); emitScroll(scrollView) }
  func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) { emitScroll(scrollView) }
  func scrollViewDidScrollToTop(_ scrollView: UIScrollView) { emitScroll(scrollView) }
  private func emitScroll(_ scrollView: UIScrollView) {
    guard !detached, !processGone else { return }
    trailingScroll?.cancel(); trailingScroll = nil
    lastScrollEmit = CACurrentMediaTime()
    emit("scroll", ["y": scrollView.contentOffset.y, "contentHeight": scrollView.contentSize.height, "viewportHeight": scrollView.bounds.height, "viewportWidth": scrollView.bounds.width])
  }
}
