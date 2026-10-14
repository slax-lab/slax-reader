package com.slax.reader.fixtures

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.slax.reader.ui.WebViewHost
import com.slax.reader.utils.AppWebViewState
import com.slax.reader.utils.WebViewEvent
import java.io.ByteArrayInputStream

/** Native local URL documents inside unchanged source Compose screens; all network is denied. */
class FixtureWebViewHost(private val documents: Map<String, String>) : WebViewHost {
    @Volatile private var activeView: WebView? = null
    @Volatile var documentReady = false
        private set
    @Volatile private var scrollComplete = false

    fun beginScroll(target: String) {
        check(target.matches(Regex("#[a-z0-9-]+"))) {"Only a declared document anchor is supported"}
        val view = checkNotNull(activeView)
        check(documentReady) {"The original URL document has not finished loading"}
        scrollComplete = false
        view.post {
            view.evaluateJavascript("(function(){var node=document.querySelector('$target');if(!node)return false;node.scrollIntoView();return true;})()") { value ->
                if (activeView === view) scrollComplete = value == "true"
            }
        }
    }

    fun isScrollComplete() = scrollComplete

    @Composable
    override fun Url(url: String, modifier: Modifier, webState: AppWebViewState, contentInsets: PaddingValues?) {
        val path = java.net.URI(url).path
        val document = documents[path] ?: error("Source agreement document is not prepared: $path")
        val policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'\">"
        val guarded = document.replaceFirst("<head>", "<head>$policy")
        AndroidView(modifier = modifier, factory = { context ->
            WebView(context).apply {
                activeView = this
                webState.webView = this
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                setOnScrollChangeListener { changed, scrollX, scrollY, _, _ ->
                    val view = changed as WebView
                    // The same measured units and source event used by the
                    // original Android URL WebView; no bottom state is assigned.
                    webState.dispatchEvent(WebViewEvent.Scroll(scrollX.toDouble(), scrollY.toDouble(),
                        (view.contentHeight * view.scale).toDouble(), view.height.toDouble()))
                }
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = true
                    override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
                        if (request?.url?.scheme in listOf("http", "https")) WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(byteArrayOf())) else null
                    override fun onPageFinished(view: WebView?, loadedUrl: String?) {
                        if (view == null || activeView !== view || loadedUrl != "about:blank") return
                        val document = view.tag
                        view.evaluateJavascript("Boolean(document.readyState !== 'loading' && document.body && document.body.textContent.trim().length > 0)") { value ->
                            if (activeView === view && view.tag == document) documentReady = value == "true"
                        }
                        webState.dispatchEvent(WebViewEvent.PageLoaded)
                        // The source URL implementation emits its initial real
                        // geometry after 300ms so short documents can be read.
                        view.postDelayed({
                            if (activeView === view && view.tag == document && documentReady) webState.dispatchEvent(WebViewEvent.Scroll(view.scrollX.toDouble(), view.scrollY.toDouble(),
                                (view.contentHeight * view.scale).toDouble(), view.height.toDouble()))
                        }, 300)
                    }
                }
            }
        }, update = { view ->
            if (view.tag != url) {documentReady = false; scrollComplete = false; view.tag = url; view.loadDataWithBaseURL("about:blank", guarded, "text/html", "UTF-8", null)}
        }, onRelease = { view -> if (activeView === view) {activeView = null; documentReady = false; webState.webView = null}; view.stopLoading(); view.destroy() })
    }
    @Composable
    override fun Html(htmlContent: String, modifier: Modifier, webState: AppWebViewState, bookmarkId: String) {
        error("Source article adapter remains pending; agreement adapter cannot substitute for it")
    }
}
