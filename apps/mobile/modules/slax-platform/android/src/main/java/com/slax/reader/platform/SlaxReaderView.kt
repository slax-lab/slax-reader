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
    fun revokeAllResources() { SlaxStorageOwner.activate(null); SlaxPdfTransfers.revokeAll(); SlaxImageModule.revokeAll(); activeOwner = null; activeViews.toList().forEach { it.detach() } }
    fun activateResources(owner: String) {
      require(Regex("^[A-Za-z0-9_-]+$").matches(owner)) { "Invalid Reader owner" }
      if (activeOwner != null && activeOwner != owner) revokeAllResources()
      if (activeOwner != owner) SlaxStorageOwner.activate(owner)
      activeOwner = owner
    }
  }
  override val shouldUseAndroidLayout = true
  val onEvent by EventDispatcher()
  val onContentHeight by EventDispatcher()
  val resourceHandler: SlaxResources = SlaxResources(context) { ownsResources() }
  @Volatile private var resourceOwner: String? = null
  fun setResourceOwner(owner: String?) {
    if (resourceOwner != null && resourceOwner != owner) { detach(); return }
    resourceOwner = owner; resourceHandler.resourceOwner = owner
  }
  var html = ""
    set(value) { field = if (detached) "" else value }
  var pageId = ""
  @Volatile private var pdfMode = false
  fun setPdfMode(value: Boolean) {
    if (pdfMode != value && (loaded != null || security != null)) { detach(); return }
    pdfMode = value
  }
  /** The document whose byte ranges this PDF host serves to its page; immutable once set. */
  @Volatile private var pdfSource: SlaxPdfSource? = null
  fun setPdfSource(raw: Map<*, *>?) {
    val next = SlaxPdfSource.parse(raw)
    if (raw != null && next == null) { emit("error", mapOf("message" to "Invalid PDF source", "code" to "pdfSource")); detach(); return }
    if (pdfSource != null && pdfSource != next) { detach(); return }
    pdfSource = next
  }
  // Requests arrive on WebView worker threads; the scope reads only volatile state of this view.
  private val pdfRanges = SlaxPdfRanges({ SlaxOfflineEngines.engine(context) }, SlaxReaderSecurity.PDF_ORIGIN) {
    val owner = resourceOwner
    val source = pdfSource
    if (!pdfMode || resourceHandler.isFixture || detached || owner == null || owner != activeOwner || loadedOwner != owner || source == null) null else source to owner
  }
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
  @Volatile private var loadedOwner: String? = null
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
    return try { url != null && canonical(url) == canonical(security?.documentOrigin ?: SlaxReaderSecurity.ORIGIN) } catch (_: Exception) { false }
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
  private var documentScrollEnabled = true
  fun setDocumentScrollEnabled(value: Boolean) {
    documentScrollEnabled = value
    if (!value) retainedWebView?.scrollTo(0, 0)
  }
  private val identity = View.generateViewId()
  private var retainedWebView: WebView? = object : WebView(context) {
    private fun suppress(callback: ActionMode.Callback): ActionMode.Callback = object : ActionMode.Callback {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean { val created = callback.onCreateActionMode(mode, menu); menu.clear(); emitTouch(); return created }
      override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean { callback.onPrepareActionMode(mode, menu); menu.clear(); return false }
      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = false
      override fun onDestroyActionMode(mode: ActionMode) { callback.onDestroyActionMode(mode) }
    }
    override fun startActionMode(callback: ActionMode.Callback): ActionMode? = super.startActionMode(suppress(callback))
    override fun startActionMode(callback: ActionMode.Callback, type: Int): ActionMode? = super.startActionMode(suppress(callback), type)
    override fun scrollTo(x: Int, y: Int) { super.scrollTo(if (documentScrollEnabled) x else 0, if (documentScrollEnabled) y else 0) }
    override fun canScrollVertically(direction: Int): Boolean = documentScrollEnabled && super.canScrollVertically(direction)
    override fun onOverScrolled(scrollX: Int, scrollY: Int, clampedX: Boolean, clampedY: Boolean) {
      super.onOverScrolled(if (documentScrollEnabled) scrollX else 0, if (documentScrollEnabled) scrollY else 0, clampedX, clampedY)
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
      screenY = event.rawY / resourceHandler.displayDensity
      // Selection placement only needs the press and release points; moves stay native.
      if (event.actionMasked == MotionEvent.ACTION_DOWN || event.actionMasked == MotionEvent.ACTION_UP) emitTouch()
      return super.onTouchEvent(event)
    }
  }
  private val webView: WebView get() = checkNotNull(retainedWebView) { "Reader page was released" }
  fun injectJavaScript(script: String) { if (permitsEvaluation()) retainedWebView?.evaluateJavascript(script, null) }
  fun stopLoading() { retainedWebView?.stopLoading() }
  fun scrollTo(y: Double) { if (!detached) retainedWebView?.scrollTo(0, (y * resourceHandler.displayDensity).toInt()) }
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
      val height = documentHeight(data)
      post {
        if (!permitsEvaluation()) return@post
        if (height != null && height.first == pageId) scheduleContentHeight(height.second)
        emit("message", mapOf("data" to data))
      }
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
        if (pdfMode && !request.isForMainFrame) pdfRanges.handle(request.url.toString(), request.method, request.requestHeaders.orEmpty())?.let {
          return WebResourceResponse(it.mimeType, null, it.status, it.reason, it.headers, it.body)
        }
        if (pdfMode && !request.isForMainFrame && request.url.scheme in listOf("blob", "data")) return null
        if (pdfMode || request.isForMainFrame || request.url.scheme in listOf("slaxmedia", "slaxmedias", "slaxstatic", "slaxstatics") && request.method != "GET") return WebResourceResponse("text/plain", "UTF-8", java.io.ByteArrayInputStream(ByteArray(0)))
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
  private fun emitTouch() = emit("touch", mapOf("screenY" to screenY))

  // The article host measures its document height (scrollHeight, CSS px == dp) and reports it through its own bridge
  // message. The value is applied to this view's container on the UI thread, deduplicated and at most once per frame.
  private var appliedContentHeight = -1.0
  private var pendingContentHeight: Double? = null
  private fun documentHeight(data: String): Pair<String, Double>? {
    if (pdfMode || data.length > 512 || !data.contains("\"contentHeight\"")) return null
    return try {
      val envelope = org.json.JSONObject(data)
      val payload = envelope.optJSONObject("payload") ?: return null
      if (envelope.optString("channel") != "slax-reader" || payload.optString("type") != "contentHeight") return null
      val height = payload.optDouble("height", Double.NaN)
      if (height.isFinite() && height > 0) envelope.optString("pageId") to height else null
    } catch (_: Exception) { null }
  }
  private fun scheduleContentHeight(height: Double) {
    val scheduled = pendingContentHeight != null
    pendingContentHeight = height
    if (scheduled) return
    postOnAnimation {
      val next = pendingContentHeight ?: return@postOnAnimation
      pendingContentHeight = null
      if (detached || kotlin.math.abs(next - appliedContentHeight) < 1.0) return@postOnAnimation
      appliedContentHeight = next
      onContentHeight(mapOf("height" to next))
    }
  }
  fun loadPendingDocument() {
    if (detached || !ownsResources()) return
    val hosts = protectedHosts ?: return
    val proxies = imageProxyOrigins ?: return
    try { security = SlaxReaderSecurity(hosts, proxies, pdfMode); resourceHandler.security = security } catch (_: Exception) { detach(); return }
    webView.settings.blockNetworkLoads = pdfMode || resourceHandler.isFixture
    webView.settings.domStorageEnabled = !pdfMode
    if (loaded != null) {
      if (loaded != html || loadedPageId != pageId) {
        emit("error", mapOf("message" to "Reader document requires a new native page", "code" to "documentReuse")); detach()
      }
      return
    }
    if (html.isNotEmpty() && pageId.isNotEmpty()) {
      resourceHandler.cancelAll(); pdfRanges.cancelAll(); loaded = html; loadedPageId = pageId; loadedOwner = resourceOwner; generation++
      var document = try { if (pdfMode) SlaxReaderSecurity.pdfDocument(html, pageId) else SlaxReaderSecurity.document(html) } catch (_: Exception) { detach(); return }
      if (resourceHandler.isFixture && !pdfMode) {
        val policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: slaxstatic: slaxstatics:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'\">"
        val head = Regex("(?i)<head(?:\\s[^>]*)?>").find(document)
        document = if (head == null) policy + document else document.substring(0, head.range.last + 1) + policy + document.substring(head.range.last + 1)
      }
      webView.loadDataWithBaseURL(security!!.documentOrigin, document, "text/html", "UTF-8", null)
    }
  }
  fun detach() {
    if (detached) return
    detached = true; generation++
    val pending = evaluations.values.toList(); evaluations.clear()
    pending.forEach { it.reject("E_READER_RELEASED", "Reader page was released", null) }
    activeViews.remove(this); resourceHandler.close(); pdfRanges.close()
    html = ""; loaded = null; loadedPageId = null; loadedOwner = null
    val released = retainedWebView
    retainedWebView = null
    released?.let {
      it.stopLoading(); it.removeJavascriptInterface("ReactNativeWebView")
      it.webViewClient = WebViewClient(); it.webChromeClient = null
      endViewTransition(it)
      removeView(it)
      it.removeAllViews(); it.destroy()
    }
  }
}
