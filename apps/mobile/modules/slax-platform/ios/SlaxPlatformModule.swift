import ExpoModulesCore
import WebKit
import UIKit
import LinkPresentation
import SafariServices

public final class SlaxPlatformModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SlaxPlatform")
    AsyncFunction("openInAppBrowser") { (raw: String, promise: Promise) in
      guard !raw.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 || $0.value == 92 }),
        let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
        let host = url.host, !host.isEmpty, url.user == nil, url.password == nil else {
        throw NSError(domain: "SlaxPlatform", code: 5, userInfo: [NSLocalizedDescriptionKey: "Invalid browser URL"])
      }
      guard let presenter = self.appContext?.utilities?.currentViewController(), presenter.viewIfLoaded?.window != nil,
        !presenter.isBeingDismissed, presenter.presentedViewController == nil else {
        throw NSError(domain: "SlaxPlatform", code: 3, userInfo: [NSLocalizedDescriptionKey: "Active screen unavailable"])
      }
      presenter.present(SFSafariViewController(url: url), animated: true) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("readerResourceOwner") { SlaxReaderView.currentOwner() }.runOnQueue(.main)
    AsyncFunction("loadReaderImage") { (id: String, url: String, owner: String, hosts: [String], proxies: [String], promise: Promise) in
      try SlaxReaderImages.load(id, raw: url, owner: owner, hosts: hosts, proxies: proxies, promise: promise)
    }.runOnQueue(.main)
    AsyncFunction("cancelReaderImage") { (id: String) in SlaxReaderImages.cancel(id) }.runOnQueue(.main)
    AsyncFunction("revokeReaderResources") { SlaxReaderImages.cancelAll(); SlaxReaderView.revokeAllResources() }.runOnQueue(.main)
    AsyncFunction("activateReaderResources") { (owner: String) in try SlaxReaderView.activateResources(owner) }.runOnQueue(.main)
    AsyncFunction("setWebSessionCookie") { (origin: URL, token: String?, domain: String, promise: Promise) in
      guard origin.scheme == "https", let host = origin.host, token?.contains(";") != true, token?.contains("\n") != true, token?.contains("\r") != true else { throw NSError(domain: "SlaxPlatform", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid HTTPS session origin"] ) }
      let root = domain.hasPrefix(".") ? String(domain.dropFirst()).lowercased() : domain.lowercased()
      guard !root.isEmpty, host.lowercased() == root || host.lowercased().hasSuffix(".\(root)") else { throw NSError(domain: "SlaxPlatform", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid cookie domain"]) }
      let store = WKWebsiteDataStore.default().httpCookieStore
      if let token {
        guard let cookie = HTTPCookie(properties: [.domain: domain, .path: "/", .name: "token", .value: token, .secure: "TRUE"]) else { throw NSError(domain: "SlaxPlatform", code: 2) }
        store.setCookie(cookie) { promise.resolve(nil) }
      } else {
        store.getAllCookies { cookies in
          let matching = cookies.filter { $0.name == "token" && [$0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))].contains(where: { $0 == host || $0 == root }) }
          let group = DispatchGroup()
          matching.forEach { cookie in group.enter(); store.delete(cookie) { group.leave() } }
          group.notify(queue: .main) { promise.resolve(nil) }
        }
      }
    }.runOnQueue(.main)
    AsyncFunction("shareArticle") { (uri: URL?, title: String, text: String, url: String, promise: Promise) in
      guard let presenter = self.appContext?.utilities?.currentViewController() else { throw NSError(domain: "SlaxPlatform", code: 3, userInfo: [NSLocalizedDescriptionKey: "Active screen unavailable"]) }
      let image = uri.flatMap { $0.isFileURL ? UIImage(contentsOfFile: $0.path) : nil }
      let item = SlaxArticleShareItem(image: image, title: title, text: text, url: URL(string: url))
      let activity = UIActivityViewController(activityItems: [item], applicationActivities: nil)
      activity.completionWithItemsHandler = { _, _, _, error in if let error { promise.reject(error) } else { promise.resolve(nil) } }
      if let popover = activity.popoverPresentationController { popover.sourceView = presenter.view; popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0) }
      presenter.present(activity, animated: true)
    }.runOnQueue(.main)
    Function("systemInfo") {
      ["Platform": "iOS", "OS Version": UIDevice.current.systemVersion, "Device": UIDevice.current.model]
    }
    AsyncFunction("resolveDns") { (host: String, server: String?) -> String in try SlaxDns.lookup(host: host, server: server) }
    AsyncFunction("shareImage") { (uri: URL, title: String, url: String?, promise: Promise) in
      guard uri.isFileURL, let image = UIImage(contentsOfFile: uri.path), let presenter = self.appContext?.utilities?.currentViewController() else { throw NSError(domain: "SlaxPlatform", code: 3, userInfo: [NSLocalizedDescriptionKey: "Image or active screen unavailable"]) }
      let item = SlaxImageShareItem(image: image, title: title, url: url.flatMap(URL.init(string:)))
      let activity = UIActivityViewController(activityItems: [item], applicationActivities: nil)
      activity.completionWithItemsHandler = { _, _, _, error in if let error { promise.reject(error) } else { promise.resolve(nil) } }
      if let popover = activity.popoverPresentationController { popover.sourceView = presenter.view; popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1) }
      presenter.present(activity, animated: true)
    }.runOnQueue(.main)
    View(SlaxReaderView.self) {
      Events("onEvent")
      Prop("html") { (view, value: String) in view.html = value }
      Prop("baseUrl") { (_: SlaxReaderView, _: String?) in }
      Prop("protectedHosts") { (view: SlaxReaderView, value: [String]) in view.setProtectedHosts(value) }
      Prop("imageProxyOrigins") { (view: SlaxReaderView, value: [String]) in view.imageProxyOrigins = value }
      Prop("cacheKey") { (view, value: String) in view.resources.cacheKey = value }
      Prop("cacheDirectory") { (view: SlaxReaderView, value: URL?) in view.setFixtureDirectory(value) }
      Prop("pageId") { (view, value: String) in view.pageId = value }
      Prop("resourceOwner") { (view: SlaxReaderView, value: String?) in view.resourceOwner = value }
      Prop("scrollsToTop") { (view, value: Bool) in view.webView.scrollView.scrollsToTop = value }
      OnViewDidUpdateProps { view in view.loadPendingDocument() }
      AsyncFunction("injectJavaScript") { (view: SlaxReaderView, script: String) in view.injectJavaScript(script) }
      AsyncFunction("evaluateJavaScript") { (view: SlaxReaderView, script: String, pageId: String, promise: Promise) in view.evaluateJavaScript(script, pageId: pageId, promise: promise) }
      AsyncFunction("stopLoading") { (view: SlaxReaderView) in view.webView.stopLoading() }
      AsyncFunction("scrollTo") { (view: SlaxReaderView, y: Double, animated: Bool) in view.webView.scrollView.setContentOffset(CGPoint(x: 0, y: y), animated: animated) }
      AsyncFunction("updateInsets") { (view: SlaxReaderView, top: Double, bottom: Double) in view.updateInsets(top: top, bottom: bottom) }
      AsyncFunction("setScrollsToTop") { (view: SlaxReaderView, enabled: Bool) in view.webView.scrollView.scrollsToTop = enabled }
      AsyncFunction("detach") { (view: SlaxReaderView) in view.detach() }
    }
    View(SlaxReaderOverlayView.self) {
      ViewName("SlaxReaderOverlayView")
      Prop("pageId") { (view: SlaxReaderOverlayView, value: String) in view.pageId = value }
      Prop("overlayKind") { (view: SlaxReaderOverlayView, value: String) in view.overlayKind = value }
      Prop("topInsetPoints") { (view: SlaxReaderOverlayView, value: Double) in view.topInsetPoints = value }
      Prop("headerHeightPoints") { (view: SlaxReaderOverlayView, value: Double) in view.headerHeightPoints = value }
      OnViewDidUpdateProps { (view: SlaxReaderOverlayView) in view.update() }
    }
    View(SlaxRingView.self) {
      ViewName("SlaxRingView")
      Prop("segments") { (view: SlaxRingView, value: String) in view.segments = value }
      Prop("diameter") { (view: SlaxRingView, value: Double) in view.diameter = value }
      Prop("thickness") { (view: SlaxRingView, value: Double) in view.thickness = value }
      Prop("track") { (view: SlaxRingView, value: String) in view.track = value }
      Prop("geometry") { (view: SlaxRingView, value: String) in view.geometry = value }
      Prop("revealDuration") { (view: SlaxRingView, value: Int) in view.revealDuration = value }
      Prop("indeterminate") { (view: SlaxRingView, value: Bool) in view.indeterminate = value }
      OnViewDidUpdateProps { (view: SlaxRingView) in view.update() }
    }
  }
}

private final class SlaxArticleShareItem: NSObject, UIActivityItemSource {
  let image: UIImage?; let title: String; let text: String; let url: URL?
  init(image: UIImage?, title: String, text: String, url: URL?) { self.image = image; self.title = title; self.text = text; self.url = url }
  func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any { text }
  func activityViewController(_ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? { text }
  func activityViewController(_ activityViewController: UIActivityViewController, subjectForActivityType activityType: UIActivity.ActivityType?) -> String { title }
  func activityViewControllerLinkMetadata(_ activityViewController: UIActivityViewController) -> LPLinkMetadata? {
    let metadata = LPLinkMetadata(); metadata.title = title; metadata.originalURL = url
    if let image { metadata.iconProvider = NSItemProvider(object: image); metadata.imageProvider = NSItemProvider(object: image) }
    return metadata
  }
}

private final class SlaxImageShareItem: NSObject, UIActivityItemSource {
  let image: UIImage; let title: String; let url: URL?
  init(image: UIImage, title: String, url: URL?) { self.image = image; self.title = title; self.url = url }
  func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any { image }
  func activityViewController(_ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? { image }
  func activityViewController(_ activityViewController: UIActivityViewController, subjectForActivityType activityType: UIActivity.ActivityType?) -> String { title }
  func activityViewControllerLinkMetadata(_ activityViewController: UIActivityViewController) -> LPLinkMetadata? {
    let metadata = LPLinkMetadata(); metadata.title = title; metadata.originalURL = url; metadata.url = url; metadata.imageProvider = NSItemProvider(object: image); return metadata
  }
}
