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
import java.io.ByteArrayInputStream

/** Real native agreement WebView inside unchanged source Compose layout, using pinned local HTML. */
class FixtureWebViewHost(private val documents: Map<String, String>) : WebViewHost {
    @Composable
    override fun Url(url: String, modifier: Modifier, webState: AppWebViewState, contentInsets: PaddingValues?) {
        val path = java.net.URI(url).path
        val document = documents[path] ?: error("Source agreement document is not prepared: $path")
        val policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'\">"
        val guarded = document.replaceFirst("<head>", "<head>$policy")
        AndroidView(modifier = modifier, factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = true
                    override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
                        if (request?.url?.scheme in listOf("http", "https")) WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(byteArrayOf())) else null
                }
            }
        }, update = { view ->
            if (view.tag != url) {view.tag = url; view.loadDataWithBaseURL("about:blank", guarded, "text/html", "UTF-8", null)}
        }, onRelease = { view -> view.stopLoading(); view.destroy() })
    }
    @Composable
    override fun Html(htmlContent: String, modifier: Modifier, webState: AppWebViewState, bookmarkId: String) {
        error("Source article adapter remains pending; agreement adapter cannot substitute for it")
    }
}
