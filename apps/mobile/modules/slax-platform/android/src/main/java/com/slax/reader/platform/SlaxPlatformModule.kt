package com.slax.reader.platform

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import android.os.Build
import android.webkit.CookieManager
import java.net.URI
import java.net.InetAddress

class SlaxPlatformModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SlaxPlatform")
    AsyncFunction("googleSignIn") Coroutine { webClientId: String ->
      SlaxGoogleSignIn.signIn(appContext.currentActivity ?: error("No active screen"), webClientId)
    }
    AsyncFunction("openInAppBrowser") { url: String ->
      val uri = URI(url)
      require(uri.scheme?.lowercase() in listOf("http", "https") && !uri.host.isNullOrBlank() && uri.rawUserInfo == null && url.none { it <= ' ' || it == '\u007f' || it == '\\' }) { "Invalid browser URL" }
      val activity = appContext.currentActivity ?: error("No active screen")
      val manager = activity.packageManager
      val browse = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://example.invalid")).addCategory(android.content.Intent.CATEGORY_BROWSABLE)
      val preferred = manager.resolveActivity(browse, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
      val candidates = listOfNotNull(preferred) + manager.queryIntentActivities(browse, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY).map { it.activityInfo.packageName }
      val provider = candidates.distinct().firstOrNull { candidate ->
        manager.resolveService(android.content.Intent("android.support.customtabs.action.CustomTabsService").setPackage(candidate), 0) != null
      }
      val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(uri.toASCIIString()))
        .addCategory(android.content.Intent.CATEGORY_BROWSABLE)
      if (provider != null) {
        intent.setPackage(provider)
        // Use the Custom Tabs wire contract; AndroidX Browser is only a debug dependency here.
        val extras = android.os.Bundle().apply { putBinder("android.support.customtabs.extra.SESSION", null) }
        intent.putExtras(extras)
        intent.putExtra("android.support.customtabs.extra.EXTRA_ENABLE_INSTANT_APPS", false)
      }
      activity.startActivity(intent)
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("readerResourceOwner") { SlaxReaderView.currentOwner() }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("revokeReaderResources") { SlaxReaderView.revokeAllResources() }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("activateReaderResources") { owner: String -> SlaxReaderView.activateResources(owner) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("setWebSessionCookie") { origin: String, token: String?, domain: String, promise: Promise ->
      val uri = URI(origin)
      require(uri.scheme == "https" && !uri.host.isNullOrBlank()) { "Session cookies require an HTTPS origin" }
      require(token == null || !token.contains(';') && !token.contains('\n') && !token.contains('\r')) { "Invalid session cookie" }
      val root = domain.removePrefix(".").lowercase()
      require(root.isNotBlank() && (uri.host.lowercase() == root || uri.host.lowercase().endsWith(".$root"))) { "Invalid cookie domain" }
      val value = if (token == null) "token=; Domain=$domain; Path=/; Secure; Max-Age=0" else "token=$token; Domain=$domain; Path=/; Secure"
      CookieManager.getInstance().setCookie(origin, value) {
        CookieManager.getInstance().flush()
        promise.resolve(null)
      }
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("shareArticle") { _uri: String?, title: String, text: String, _url: String ->
      val activity = appContext.currentActivity ?: error("No active screen")
      val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(android.content.Intent.EXTRA_SUBJECT, title)
        putExtra(android.content.Intent.EXTRA_TEXT, text)
      }
      activity.startActivity(android.content.Intent.createChooser(intent, title))
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("resolveDns") { host: String, server: String? ->
      if (server == null) InetAddress.getAllByName(host).joinToString(", ") { it.hostAddress.orEmpty() }
      else SlaxDns.lookup(host, server)
    }
    Function("systemInfo") {
      mapOf("Platform" to "Android", "OS Version" to Build.VERSION.RELEASE, "SDK Version" to Build.VERSION.SDK_INT.toString(), "Device" to "${Build.MANUFACTURER} ${Build.MODEL}")
    }
    AsyncFunction("shareImage") { _uri: String, title: String, url: String? ->
      val activity = appContext.currentActivity ?: error("No active screen")
      val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(android.content.Intent.EXTRA_SUBJECT, title)
        putExtra(android.content.Intent.EXTRA_TEXT, listOfNotNull(title, url).joinToString("\n"))
      }
      activity.startActivity(android.content.Intent.createChooser(intent, null))
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    View(SlaxReaderView::class) {
      Events("onEvent", "onContentHeight")
      Prop("html") { view: SlaxReaderView, value: String -> view.html = value }
      Prop("baseUrl") { _view: SlaxReaderView, _value: String? -> }
      Prop("pdfMode") { view: SlaxReaderView, value: Boolean -> view.setPdfMode(value) }
      Prop("protectedHosts") { view: SlaxReaderView, value: List<String> -> view.setProtectedHosts(value) }
      Prop("imageProxyOrigins") { view: SlaxReaderView, value: List<String> -> view.imageProxyOrigins = value }
      Prop("cacheKey") { view: SlaxReaderView, value: String -> view.resourceHandler.cacheKey = value }
      Prop("cacheDirectory") { view: SlaxReaderView, value: String? -> view.resourceHandler.setFixtureDirectory(value) }
      Prop("pageId") { view: SlaxReaderView, value: String -> view.pageId = value }
      Prop("resourceOwner") { view: SlaxReaderView, value: String? -> view.setResourceOwner(value) }
      Prop("scrollsToTop") { _view: SlaxReaderView, _value: Boolean -> }
      Prop("scrollEnabled") { view: SlaxReaderView, value: Boolean -> view.setDocumentScrollEnabled(value) }
      OnViewDidUpdateProps { view: SlaxReaderView -> view.loadPendingDocument() }
      OnViewDestroys { view: SlaxReaderView -> view.detach() }
      AsyncFunction("injectJavaScript") { view: SlaxReaderView, script: String -> view.injectJavaScript(script) }
      AsyncFunction("evaluateJavaScript") { view: SlaxReaderView, script: String, pageId: String, promise: Promise -> view.evaluateJavaScript(script, pageId, promise) }
      AsyncFunction("stopLoading") { view: SlaxReaderView -> view.stopLoading() }
      AsyncFunction("scrollTo") { view: SlaxReaderView, y: Double, _animated: Boolean -> view.scrollTo(y) }
      AsyncFunction("updateInsets") { _view: SlaxReaderView, _top: Double, _bottom: Double -> }
      AsyncFunction("setScrollsToTop") { _view: SlaxReaderView, _enabled: Boolean -> }
      AsyncFunction("detach") { view: SlaxReaderView -> view.detach() }
    }
    View(SlaxRingView::class) {
      Name("SlaxRingView")
      Prop("segments") { view: SlaxRingView, value: String -> view.segments = value }
      Prop("diameter") { view: SlaxRingView, value: Double -> view.diameter = value }
      Prop("thickness") { view: SlaxRingView, value: Double -> view.thickness = value }
      Prop("track") { view: SlaxRingView, value: String -> view.track = value }
      Prop("geometry") { view: SlaxRingView, value: String -> view.geometry = value }
      Prop("revealDuration") { view: SlaxRingView, value: Int -> view.revealDuration = value }
      Prop("indeterminate") { view: SlaxRingView, value: Boolean -> view.indeterminate = value }
      OnViewDidUpdateProps { view: SlaxRingView -> view.update() }
    }
    View(SlaxTextView::class) {
      Name("SlaxTextView")
      Events("onTextMetrics")
      Prop("text") { view: SlaxTextView, value: String -> view.text = value }
      Prop("fontSize") { view: SlaxTextView, value: Double -> view.fontSize = value }
      Prop("fontWeight") { view: SlaxTextView, value: Int -> view.fontWeight = value }
      Prop("textColor") { view: SlaxTextView, value: String -> view.textColor = value }
      Prop("alignment") { view: SlaxTextView, value: String -> view.alignment = value }
      Prop("centerAsGroup") { view: SlaxTextView, value: Boolean -> view.centerAsGroup = value }
      Prop("ellipsis") { view: SlaxTextView, value: String -> view.ellipsis = value }
      Prop("paragraph") { view: SlaxTextView, value: Boolean -> view.paragraph = value }
      Prop("maxLines") { view: SlaxTextView, value: Int -> view.maxLines = value }
      Prop("lineHeightSp") { view: SlaxTextView, value: Double -> view.lineHeightSp = value }
      Prop("measurementKey") { view: SlaxTextView, value: String -> view.measurementKey = value }
      OnViewDidUpdateProps { view: SlaxTextView -> view.update() }
    }
    View(SlaxShapeView::class) {
      Name("SlaxShapeView")
      Prop("radius") { view: SlaxShapeView, value: Double -> view.radius = value }
      Prop("corners") { view: SlaxShapeView, value: String -> view.corners = value }
      Prop("fillColor") { view: SlaxShapeView, value: String -> view.fillColor = value }
      Prop("borderColor") { view: SlaxShapeView, value: String -> view.borderColor = value }
      Prop("borderWidth") { view: SlaxShapeView, value: Double -> view.borderWidth = value }
      OnViewDidUpdateProps { view: SlaxShapeView -> view.update() }
    }
  }
}
