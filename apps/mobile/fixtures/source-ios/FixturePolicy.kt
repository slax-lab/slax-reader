@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package com.slax.reader.fixtures
import platform.WebKit.WKContentRuleList

/** Prepared by UIKit before any original WKWebView is constructed. */
private var contentRules: WKContentRuleList? = null
fun setFixtureWebRules(rules: WKContentRuleList) {check(contentRules == null); contentRules = rules}
fun fixtureWebRules(): WKContentRuleList = checkNotNull(contentRules) {"Native network blocking must precede original WebView creation"}

fun fixtureBlockedSafari(url: String): platform.SafariServices.SFSafariViewController =
    error("External Safari navigation is unavailable in controlled source UI fixtures: $url")
