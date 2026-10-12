@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package com.slax.reader.fixtures
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitView
import com.slax.reader.ui.WebViewHost
import com.slax.reader.utils.AppWebViewState
import com.slax.reader.utils.WebViewEvent
import com.slax.reader.utils.toUIEdgeInsets
import kotlinx.cinterop.useContents
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import platform.CoreGraphics.CGRectMake
import platform.Foundation.NSURL
import platform.UIKit.*
import platform.WebKit.*
import platform.darwin.NSObject
import platform.darwin.dispatch_after
import platform.darwin.dispatch_get_main_queue
import platform.darwin.dispatch_time

/** Original legal screens receive real local WK documents and unchanged native event semantics. */
class FixtureWebViewHost(private val documents: Map<String, String>) : WebViewHost {
    private data class Observation(val generation: Int, val ready: Boolean = false, val loaded: Boolean = false,
        val scrollEvents: Int = 0, val contentHeight: Double = 0.0, val viewportHeight: Double = 0.0)
    private val observations = MutableStateFlow<Map<String, Observation>>(emptyMap())
    private var sequence = 0
    fun isDocumentReady(path: String): Boolean = observations.value[path]?.let {
        it.ready && it.loaded && it.scrollEvents > 0 && it.contentHeight > 0 && it.viewportHeight > 0
    } == true
    fun close() {observations.value = emptyMap()}

    @Composable override fun Url(url: String, modifier: Modifier, webState: AppWebViewState, contentInsets: PaddingValues?) {
        val path = NSURL.URLWithString(url)?.path ?: error("Unprepared legal URL")
        check(url == "https://fixture-pages.test$path") {"Unprepared original legal origin"}
        val html = documents[path] ?: error("Unprepared original legal document")
        val policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'\">"
        val guarded = html.replaceFirst("<head>", "<head>$policy")
        val generation = remember(url, webState) {++sequence}
        val active = remember(generation) {booleanArrayOf(true)}
        fun publishScroll(scrollView: UIScrollView) {
            if (!active[0] || observations.value[path]?.generation != generation) return
            val x = scrollView.contentOffset.useContents {x}; val y = scrollView.contentOffset.useContents {y}
            val height = scrollView.contentSize.useContents {height}; val viewport = scrollView.bounds.useContents {size.height}
            observations.update {values -> values + (path to values.getValue(path).copy(
                scrollEvents = values.getValue(path).scrollEvents + 1, contentHeight = height, viewportHeight = viewport))}
            // These are the original Url WebView's native callbacks. In
            // particular, DeleteAccount derives bottom readiness itself.
            webState.dispatchEvent(WebViewEvent.Scroll(x, y, height, viewport))
        }
        val scrollDelegate = remember(generation) {object : NSObject(), UIScrollViewDelegateProtocol {
            override fun scrollViewDidScroll(scrollView: UIScrollView) {publishScroll(scrollView)}
        }}
        val navigationDelegate = remember(generation) {object : NSObject(), WKNavigationDelegateProtocol {
            override fun webView(webView: WKWebView, didFinishNavigation: WKNavigation?) {
                if (!active[0] || observations.value[path]?.generation != generation) return
                observations.update {values -> values + (path to values.getValue(path).copy(loaded = true))}
                webState.dispatchEvent(WebViewEvent.PageLoaded)
                webView.evaluateJavaScript("Boolean(document.readyState !== 'loading' && document.body && document.body.innerText.trim().length)") {result, error ->
                    if (active[0] && observations.value[path]?.generation == generation && error == null) {
                        val ready = result?.toString() in listOf("true", "1")
                        observations.update {values -> values + (path to values.getValue(path).copy(ready = ready))}
                    }
                }
                // The pinned original Url helper emits one measured Scroll
                // 300ms after native PageLoaded, without changing an offset.
                dispatch_after(dispatch_time(platform.darwin.DISPATCH_TIME_NOW, 300_000_000L), dispatch_get_main_queue()) {
                    publishScroll(webView.scrollView)
                }
            }
        }}
        UIKitView(modifier = modifier, factory = {
            observations.update {it + (path to Observation(generation))}
            WKWebView(frame = CGRectMake(0.0, 0.0, 0.0, 0.0), configuration = WKWebViewConfiguration().apply {
                userContentController.addContentRuleList(fixtureWebRules())
            }).apply {
                webState.webView = this
                backgroundColor = UIColor.colorWithRed(252.0 / 255, 252.0 / 255, 252.0 / 255, 1.0)
                scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentBehavior.UIScrollViewContentInsetAdjustmentNever
                scrollView.alwaysBounceVertical = true; scrollView.alwaysBounceHorizontal = false
                scrollView.delegate = scrollDelegate; this.navigationDelegate = navigationDelegate
                scrollView.contentInset = contentInsets?.toUIEdgeInsets ?: UIEdgeInsets_zero
                loadHTMLString(guarded, baseURL = null)
            }
        }, update = {it.scrollView.contentInset = contentInsets?.toUIEdgeInsets ?: UIEdgeInsets_zero}, onRelease = {
            active[0] = false; it.stopLoading(); it.navigationDelegate = null; it.scrollView.delegate = null
            if (webState.webView === it) webState.webView = null
            observations.update {values -> if (values[path]?.generation == generation) values - path else values}
        })
    }
    @Composable override fun Html(htmlContent: String, modifier: Modifier, webState: AppWebViewState, bookmarkId: String) {
        error("Agreement host cannot substitute for the actual original Reader")
    }
}
