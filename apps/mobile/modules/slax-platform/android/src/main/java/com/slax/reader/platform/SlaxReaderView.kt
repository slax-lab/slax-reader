package com.slax.reader.platform

import android.content.Context
import android.graphics.Color
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher

class SlaxReaderView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  companion object {
    // All view creation, disposal, and account revocation run on the UI queue.
    private val activeViews = java.util.Collections.newSetFromMap(java.util.WeakHashMap<SlaxReaderView, Boolean>())
    @Volatile private var activeOwner: String? = null
    fun owns(owner: String) = activeOwner == owner
    fun currentOwner() = activeOwner
    fun revokeAllResources() { activeOwner = null; SlaxReaderImages.cancelAll(); activeViews.toList().forEach { it.detach() } }
    fun activateResources(owner: String) {
      require(Regex("^[A-Za-z0-9_-]+$").matches(owner)) { "Invalid Reader owner" }
      if (activeOwner != null && activeOwner != owner) revokeAllResources()
      activeOwner = owner
    }
  }
  override val shouldUseAndroidLayout = true
  val onEvent by EventDispatcher()
  val resourceHandler: SlaxResources = SlaxResources(context) { ownsResources() }
  @Volatile private var resourceOwner: String? = null
  fun setResourceOwner(owner: String?) {
    if (resourceOwner != null && resourceOwner != owner) { detach(); return }
    resourceOwner = owner
  }
  var html = ""; var pageId = ""
  private var security: SlaxReaderSecurity? = null
  private var protectedHosts: List<String>? = null
  var imageProxyOrigins: List<String>? = null
    set(value) { if (field != null && field != value) { detach(); return }; field = value }
  fun setProtectedHosts(hosts: List<String>) {
    if (protectedHosts != null && protectedHosts != hosts) { detach(); return }
    protectedHosts = hosts
  }
  private var loaded: String? = null
  private var loadedPageId: String? = null
  private var loadedOwner: String? = null
  private var generation = 0
  private var navigationStarted = false
  private var evaluationSequence = 0
  private val evaluations = mutableMapOf<Int, expo.modules.kotlin.Promise>()
  private fun permitsEvaluation() = ownsResources() && navigationStarted && loaded == html && loadedPageId == pageId && loadedOwner == resourceOwner
  private fun initialUrl(url: String?): Boolean {
    fun canonical(value: String): String {
      val uri = java.net.URI(value)
      return if (uri.scheme in listOf("http", "https") && uri.rawPath.isNullOrEmpty())
        java.net.URI(uri.scheme, uri.authority, "/", uri.query, uri.fragment).toASCIIString() else uri.toASCIIString()
    }
    return try { url != null && canonical(url) == canonical(SlaxReaderSecurity.ORIGIN) } catch (_: Exception) { false }
  }
  fun evaluateJavaScript(script: String, pageId: String, promise: expo.modules.kotlin.Promise) {
    if (!permitsEvaluation() || loadedPageId != pageId) { promise.reject("E_READER_RELEASED", "Reader page was released", null); return }
    val currentGeneration = generation
    val id = ++evaluationSequence
    evaluations[id] = promise
    postDelayed({ evaluations.remove(id)?.reject("E_READER_TIMEOUT", "Reader native evaluation timed out", null) }, 10000)
    try {
      webView.evaluateJavascript(script) { value ->
        val pending = evaluations.remove(id) ?: return@evaluateJavascript
        if (!permitsEvaluation() || generation != currentGeneration || loadedPageId != pageId) pending.reject("E_READER_RELEASED", "Reader page was released", null)
        else pending.resolve(value)
      }
    } catch (_: Exception) {
      evaluations.remove(id)?.reject("E_READER_EVALUATION", "Reader native evaluation failed", null)
    }
  }
  @Volatile private var detached = false
  private fun ownsResources(): Boolean = !detached && (resourceHandler.isFixture || resourceOwner != null && resourceOwner == activeOwner)
  private var screenY = 0.0
  private val identity = View.generateViewId()
  val webView = object : WebView(context) {
    private fun suppress(callback: ActionMode.Callback): ActionMode.Callback = object : ActionMode.Callback {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean { val created = callback.onCreateActionMode(mode, menu); menu.clear(); emit("touch", mapOf("screenY" to screenY)); return created }
      override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean { callback.onPrepareActionMode(mode, menu); menu.clear(); return false }
      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = false
      override fun onDestroyActionMode(mode: ActionMode) { callback.onDestroyActionMode(mode) }
    }
    override fun startActionMode(callback: ActionMode.Callback): ActionMode? = super.startActionMode(suppress(callback))
    override fun startActionMode(callback: ActionMode.Callback, type: Int): ActionMode? = super.startActionMode(suppress(callback), type)
    override fun onTouchEvent(event: MotionEvent): Boolean {
      screenY = event.rawY / resourceHandler.displayDensity
      if (event.actionMasked == MotionEvent.ACTION_DOWN || event.actionMasked == MotionEvent.ACTION_MOVE || event.actionMasked == MotionEvent.ACTION_UP) emit("touch", mapOf("screenY" to screenY))
      return super.onTouchEvent(event)
    }
  }
  init {
    activeViews.add(this)
    webView.setBackgroundColor(Color.TRANSPARENT)
    android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
    webView.settings.apply {
      javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false
      builtInZoomControls = false; displayZoomControls = false; setSupportMultipleWindows(false)
      mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
      mediaPlaybackRequiresUserGesture = false
    }
    webView.isVerticalScrollBarEnabled = false; webView.isHorizontalScrollBarEnabled = false
    webView.overScrollMode = View.OVER_SCROLL_NEVER
    webView.addJavascriptInterface(object { @JavascriptInterface fun postMessage(data: String) {
      if (data.length > 8 * 1024 * 1024) return
      post { if (permitsEvaluation()) emit("message", mapOf("data" to data)) }
    } }, "ReactNativeWebView")
    webView.webChromeClient = WebChromeClient()
    webView.webViewClient = object : WebViewClient() {
      override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
        if (navigationStarted || loaded == null || !initialUrl(url)) {
          emit("error", mapOf("message" to "Reader document navigation was rejected", "code" to "documentNavigation")); detach(); return
        }
        navigationStarted = true
        emit("loadStart")
      }
      override fun onPageFinished(view: WebView, url: String?) { emit("loadEnd") }
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        if (request.isForMainFrame || request.url.scheme in listOf("slaxmedia", "slaxmedias", "slaxstatic", "slaxstatics") && request.method != "GET") return WebResourceResponse("text/plain", "UTF-8", java.io.ByteArrayInputStream(ByteArray(0)))
        return resourceHandler.intercept(request.url.toString(), request.requestHeaders)
      }
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        if (resourceHandler.isFixture || security?.allows(url) != true) return true
        if (!request.isForMainFrame) return request.url.scheme != "https"
        if (request.hasGesture()) emit("external", mapOf("url" to url))
        return true
      }
      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) { if (request.isForMainFrame) { emit("error", mapOf("message" to error.description.toString())); detach() } }
      override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean { emit("error", mapOf("message" to "Reader process interrupted", "code" to "renderProcessGone")); detach(); return true }
    }
    addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }
  private fun emit(type: String, fields: Map<String, Any> = emptyMap()) { if (!detached) onEvent(fields + mapOf("type" to type, "target" to identity, "pageId" to pageId)) }
  fun loadPendingDocument() {
    if (detached || !ownsResources()) return
    val hosts = protectedHosts ?: return
    val proxies = imageProxyOrigins ?: return
    try { security = SlaxReaderSecurity(hosts, proxies); resourceHandler.security = security } catch (_: Exception) { detach(); return }
    webView.settings.blockNetworkLoads = resourceHandler.isFixture
    if (loaded != null) {
      if (loaded != html || loadedPageId != pageId) {
        emit("error", mapOf("message" to "Reader document requires a new native page", "code" to "documentReuse")); detach()
      }
      return
    }
    if (html.isNotEmpty() && pageId.isNotEmpty()) {
      resourceHandler.cancelAll(); loaded = html; loadedPageId = pageId; loadedOwner = resourceOwner; generation++
      var document = SlaxReaderSecurity.document(html)
      if (resourceHandler.isFixture) {
        val policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: slaxstatic: slaxstatics:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'\">"
        val head = Regex("(?i)<head(?:\\s[^>]*)?>").find(document)
        document = if (head == null) policy + document else document.substring(0, head.range.last + 1) + policy + document.substring(head.range.last + 1)
      }
      webView.loadDataWithBaseURL(SlaxReaderSecurity.ORIGIN, document, "text/html", "UTF-8", null)
    }
  }
  fun detach() {
    if (detached) return
    detached = true; generation++
    val pending = evaluations.values.toList(); evaluations.clear()
    pending.forEach { it.reject("E_READER_RELEASED", "Reader page was released", null) }
    activeViews.remove(this); resourceHandler.close(); webView.stopLoading(); webView.removeJavascriptInterface("ReactNativeWebView"); webView.destroy()
  }
}
