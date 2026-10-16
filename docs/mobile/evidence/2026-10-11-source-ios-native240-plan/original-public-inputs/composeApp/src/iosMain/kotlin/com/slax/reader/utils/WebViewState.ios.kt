package com.slax.reader.utils

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import platform.Foundation.NSHTTPCookie
import platform.Foundation.NSHTTPCookieDomain
import platform.Foundation.NSHTTPCookieExpires
import platform.Foundation.NSHTTPCookieName
import platform.Foundation.NSHTTPCookiePath
import platform.Foundation.NSHTTPCookieSecure
import platform.Foundation.NSHTTPCookieValue
import platform.Foundation.NSDate
import platform.Foundation.dateWithTimeIntervalSince1970
import platform.WebKit.WKWebView

@Stable
actual class AppWebViewState actual constructor(
    private val scope: CoroutineScope,
    actual val initialCookies: List<WebViewCookie>?
) {
    internal var webView: WKWebView? = null

    private val _commands = MutableSharedFlow<WebViewCommand>(extraBufferCapacity = 8)
    internal val commands = _commands.asSharedFlow()

    private val _events = MutableSharedFlow<WebViewEvent>(extraBufferCapacity = 8)
    actual val events = _events.asSharedFlow()

    var topContentInsetPx by mutableFloatStateOf(0f)
    var bottomContentInsetPx by mutableFloatStateOf(0f)

    actual fun evaluateJs(script: String) {
        scope.launch { _commands.emit(WebViewCommand.EvaluateJs(script)) }
    }

    actual fun evaluateJsWithCallback(script: String, callback: (String) -> Unit) {
        scope.launch { _commands.emit(WebViewCommand.EvaluateJs(script, callback)) }
    }

    actual fun scrollToAnchor(anchor: String) {
        evaluateJs("window.SlaxWebViewBridge.scrollToAnchor(`${escapeJsTemplateString(anchor)}`)")
    }

    internal fun dispatchEvent(event: WebViewEvent) {
        scope.launch { _events.emit(event) }
    }

    actual fun reload() {
        webView?.reload()
    }

    actual fun setCookies(cookies: List<WebViewCookie>, url: String, complateHandler: (() -> Unit)?) {
        val webView = this.webView ?: return
        val cookieStore = webView.configuration.websiteDataStore.httpCookieStore
        var cookiesSet = 0
        val totalCookies = cookies.size

        if (cookies.isNotEmpty()) {
            cookies.forEach { cookie ->
                val properties = mutableMapOf<Any?, Any?>(
                    NSHTTPCookieName to cookie.name,
                    NSHTTPCookieValue to cookie.value,
                    NSHTTPCookieDomain to cookie.domain,
                    NSHTTPCookiePath to cookie.path
                )

                if (cookie.secure) {
                    properties[NSHTTPCookieSecure] = "TRUE"
                }

                cookie.expiresDate?.let {
                    val timeInterval = it / 1000.0
                    properties[NSHTTPCookieExpires] = NSDate.dateWithTimeIntervalSince1970(timeInterval)
                }

                NSHTTPCookie.cookieWithProperties(properties)?.let { nsCookie ->
                    cookieStore.setCookie(nsCookie) {
                        cookiesSet++
                        if (cookiesSet == totalCookies) {
                            complateHandler?.invoke()
                        }
                    }
                }
            }
        } else {
            complateHandler?.invoke()
        }
    }
}