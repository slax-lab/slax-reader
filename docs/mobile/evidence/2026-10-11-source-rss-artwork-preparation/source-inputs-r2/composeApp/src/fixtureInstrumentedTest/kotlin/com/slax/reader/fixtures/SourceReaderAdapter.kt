package com.slax.reader.fixtures

import android.content.Context
import android.content.res.AssetManager
import android.util.Base64
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.viewModelScope
import com.powersync.PowerSyncDatabase
import com.slax.reader.data.database.dao.*
import com.slax.reader.data.file.FileManager
import com.slax.reader.data.network.ApiService
import com.slax.reader.data.network.RssRepository
import com.slax.reader.data.preferences.AppPreferences
import com.slax.reader.domain.coordinator.CoordinatorDomain
import com.slax.reader.domain.image.ImageDownloadManager
import com.slax.reader.domain.image.ShareImageSelector
import com.slax.reader.domain.sync.BackgroundDomain
import com.slax.reader.domain.sync.CollectionBackgroundDomain
import com.slax.reader.ui.AppLifecycle
import com.slax.reader.ui.PlatformWebViewHost
import com.slax.reader.ui.WebViewHost
import com.slax.reader.ui.bookmark.BookmarkDetailViewModel
import com.slax.reader.ui.bookmark.DetailScreen
import com.slax.reader.ui.bookmark.DetailScreenEvent
import com.slax.reader.ui.bookmark.RssReader
import com.slax.reader.ui.bookmark.states.BookmarkOverlay
import com.slax.reader.ui.bookmark.states.toStableId
import com.slax.reader.ui.rss.RssArticleViewModel
import com.slax.reader.utils.AppLifecycleState
import com.slax.reader.utils.AppWebViewState
import com.slax.reader.utils.Connector
import com.slax.reader.utils.FirstPartyEventReporter
import io.ktor.client.HttpClient
import dev.jordond.connectivity.Connectivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import okio.FileSystem
import java.io.File
import java.security.MessageDigest
import kotlin.coroutines.resume

/** Real source view model, delegates and native reader; only input/storage/lifecycle are controlled. */
class SourceReaderAdapter(
    context: Context,
    assets: AssetManager,
    private val scenario: JsonObject,
    database: PowerSyncDatabase,
    preferences: AppPreferences,
    @Suppress("UNUSED_PARAMETER") http: HttpClient,
    private val scope: CoroutineScope,
    reporter: FirstPartyEventReporter,
    subscriptionDao: SubscriptionDao = SubscriptionDao(scope, database),
    userDao: UserDao = UserDao(scope, database),
) {
    private val payload = scenario.getValue("payload").jsonObject
    private val params = scenario.getValue("route").jsonObject.getValue("params").jsonObject
    private val lifecycleState = MutableStateFlow(AppLifecycleState.ON_RESUME)
    private val lifecycle = object : AppLifecycle {
        override val state = lifecycleState
        override fun attach(owner: LifecycleOwner) = Unit
        override fun detach(owner: LifecycleOwner) = Unit
    }
    private val files = FileManager(FileSystem.SYSTEM)
    private val fixtureHttp = FixtureReaderHttp(payload)
    private val api = ApiService(fixtureHttp.client)
    /** The original RSS route uses its own repository and view model, not BookmarkDetailViewModel. */
    val rssViewModel = params["rssEntryId"]?.jsonPrimitive?.content?.let { RssArticleViewModel(RssRepository(FixtureApi(payload))) }
    val imageDownloadManager = ImageDownloadManager(files, fixtureHttp.client)
    private val bookmarks = BookmarkDao(scope, database)
    private val collections = CollectionDao(scope, database)
    private val local = LocalBookmarkDao(scope, database)
    // A normal preceding Library subscribes to this same unchanged source DAO.
    // Observe its current download status without writing or bypassing loading.
    private val downloadStatus = local.watchUserLocalBookmarkMap()
    // The pinned view model requires the concrete source coordinator. Its
    // connectivity is real; a mismatched device/payload state fails readiness.
    private val connected = payload.getValue("network").jsonObject.getValue("isConnected").jsonPrimitive.boolean
    private val coordinator = CoordinatorDomain(database, Connector(api, preferences), PowerSyncDao(database))
    val viewModel = BookmarkDetailViewModel(
        bookmarks, collections, subscriptionDao, local,
        BookmarkCommentDao(database), userDao,
        BackgroundDomain(bookmarks, local, files, api, imageDownloadManager, preferences),
        coordinator, CollectionBackgroundDomain(collections, local, files, api, imageDownloadManager, preferences),
        api, preferences, database, ShareImageSelector(imageDownloadManager), reporter, scope,
    )
    @Volatile private var webState: AppWebViewState? = null
    @Volatile private var documentHtml: String? = null
    private val readinessLock = Any()
    private var readinessState: AppWebViewState? = null
    private var readinessHtml: String? = null
    private var readinessScript: String? = null
    private var readinessGeneration = 0L
    private var readinessPendingSince = 0L
    private var readinessPending = false
    private var readinessReady = false
    @Volatile private var readinessBlockReason = "not-polled"
    private var readinessLastProbeValue: String? = null
    private var readinessLastDomValue: String? = null
    private var closed = false
    private var actionGeneration = 0L
    private var actionJob: Job? = null
    private var actionDone = false
    private var actionFailure: Throwable? = null
    /** A normal source Library visit subscribes to this same DAO before opening Reader. */
    val lifecyclePreparation = "prior-library-shared-user-and-subscription-dao-collectors"
    private val expectedUserId = payload.getValue("session").jsonObject.getValue("userId").jsonPrimitive.content
    private val expectedSubscriptionEnd = payload.getValue("database").jsonObject
        .getValue("sr_user_subscription").jsonArray.firstOrNull()?.jsonObject
        ?.get("subscription_end_time")?.jsonPrimitive?.content
    private val subscriptionJob = scope.launch {
        subscriptionDao.watchSubscriptionInfo().collect {}
    }
    private val userJob = scope.launch {userDao.watchUserInfo().collect {}}
    private val host = object : WebViewHost {
        @Composable override fun Url(url: String, modifier: Modifier, webState: AppWebViewState, contentInsets: PaddingValues?) {
            error("Source reader fixture does not allow remote URL WebViews")
        }
        @Composable override fun Html(htmlContent: String, modifier: Modifier, webState: AppWebViewState, bookmarkId: String) {
            this@SourceReaderAdapter.webState = webState
            documentHtml = htmlContent
            // Keep the actual source AppWebView and bridge. The policy only disables
            // external resources in the no-INTERNET fixture application. Declared
            // synthetic HTTPS images receive checksum-verified local responses.
            val policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: slaxstatic: slaxstatics: https://fixture-images.test; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'\">"
            val head = Regex("(?i)<head(?:\\s[^>]*)?>").find(htmlContent)
            val document = if (head == null) policy + htmlContent else htmlContent.substring(0, head.range.last + 1) + policy + htmlContent.substring(head.range.last + 1)
            PlatformWebViewHost.Html(document, modifier, webState, bookmarkId)
        }
    }

    init {
        check(context.packageName == "com.slax.reader.fixture" || context.packageName.startsWith("com.slax.reader.fixture."))
        val root = context.dataDir.canonicalFile
        val cacheRoot = File(root, "bookmark").canonicalFile
        check(cacheRoot.path.startsWith(root.path + File.separator))
        // Instrumentation processes share this isolated application container.
        // Clear only its reader fixture caches so an earlier cached case cannot
        // satisfy the later uncached/error case.
        if (cacheRoot.exists()) check(cacheRoot.deleteRecursively())
        check(cacheRoot.mkdirs())
        val resourceSource = assets.open("slax-ui-fixtures/resources.ts").bufferedReader().use { it.readText() }
        val base64 = Regex("fixtureArtworkBase64\\s*=\\s*\"([A-Za-z0-9+/=]+)\"").find(resourceSource)?.groupValues?.get(1)
            ?: error("Prepared source fixture artwork is missing")
        val artwork = Base64.decode(base64, Base64.DEFAULT)
        val imageUrls = Regex("\"(https://fixture-images\\.test/[^\"]+)\"\\s*:").findAll(resourceSource).map { it.groupValues[1] }.toList()
        payload.getValue("cache").jsonArray.forEach { item ->
            val record = item.jsonObject
            val key = record.getValue("key").jsonPrimitive.content
            val htmlFile = record.getValue("htmlFile").jsonPrimitive.content
            check(key.matches(Regex("[A-Za-z0-9_-]+")) && htmlFile.matches(Regex("articles/[a-z-]+\\.html")))
            val directory = File(root, "bookmark/$key").canonicalFile
            check(directory.path.startsWith(root.path + File.separator))
            directory.mkdirs()
            File(directory, "content.html").writeBytes(assets.open("slax-ui-fixtures/$htmlFile").use { it.readBytes() })
            imageUrls.filterNot { it.contains("/failure.png") }.forEach { url ->
                val hash = MessageDigest.getInstance("MD5").digest(url.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
                val ext = url.substringAfterLast('.', "").substringBefore('?').substringBefore('&').take(10).lowercase().ifEmpty { "jpg" }
                File(directory, "images/$hash.$ext").apply { parentFile!!.mkdirs(); writeBytes(artwork) }
            }
        }
        // RssReader passes this key to the unchanged source WebView/gallery.
        val resourceKey = params["rssEntryId"]?.jsonPrimitive?.content?.let {"rss-$it"} ?: "fixture-resources"
        FixtureReaderResources.prepare(root, resourceKey, imageUrls, artwork)
    }

    @Composable fun Render(onEvent: (DetailScreenEvent) -> Unit = {}) {
        val rssEntryId = params["rssEntryId"]?.jsonPrimitive?.content
        if (rssEntryId != null) {
            RssReader(rssEntryId, onBack = {error("Source fixture RSS navigation requires a native action driver")}, webViewHost = host, model = checkNotNull(rssViewModel))
            return
        }
        val sourceUser by viewModel.userInfo.collectAsState()
        val sourceSubscription by viewModel.subscriptionInfo.collectAsState()
        // Normal navigation has already rendered the Library and loaded its
        // shared DAO values. Mount the unchanged Reader only after those same
        // concrete source values are ready; otherwise PageLoaded captures id=0.
        if (expectedUserId.isNotEmpty() && sourceUser?.id != expectedUserId) return
        if (expectedSubscriptionEnd != null && sourceSubscription?.subscription_end_time != expectedSubscriptionEnd) return
        DetailScreen(
            bookmarkId = params.getValue("bookmarkId").jsonPrimitive.content,
            collectionOwnerId = params["collectionOwnerId"]?.jsonPrimitive?.content,
            collectionId = params["collectionId"]?.jsonPrimitive?.content,
            onEvent = onEvent, viewModel = viewModel, lifecycle = lifecycle, webViewHost = host,
        )
    }

    suspend fun isDocumentReady(): Boolean {
        rssViewModel?.let { model ->
            val state = model.state.value
            val entryId = params.getValue("rssEntryId").jsonPrimitive.content
            if (state.busy) {readinessBlockReason = "rss-busy"; return false}
            if (state.entry?.id != entryId) {readinessBlockReason = "rss-entry-not-loaded"; return false}
            val html = documentHtml ?: run {readinessBlockReason = "rss-native-html-not-mounted"; return false}
            readinessBlockReason = "rss-await-actual-dom-probe"
            // The unchanged RSS preview deliberately has no BookmarkDetailViewModel
            // and never starts annotation monitoring, so markManager stays null.
            return probeDocument(html, "Boolean(document.readyState !== 'loading' && window.SlaxWebViewBridge && document.body && document.body.innerText.trim().length > 0)")
        }
        val state = viewModel.contentState.value
        val html = state.htmlContent ?: run {readinessBlockReason = "bookmark-html-missing"; return false}
        if (state.isLoading) {readinessBlockReason = "bookmark-loading"; return false}
        if (expectedUserId.isNotEmpty() && viewModel.userInfo.value?.id != expectedUserId) {readinessBlockReason = "source-user-not-loaded"; return false}
        // Readiness must observe the real prepared database row, rather than
        // assigning a synthetic Pro value or accepting the initial null flow.
        if (expectedSubscriptionEnd != null && viewModel.subscriptionInfo.value?.subscription_end_time != expectedSubscriptionEnd) {readinessBlockReason = "source-subscription-not-loaded"; return false}
        val bookmarkId = params.getValue("bookmarkId").jsonPrimitive.content
        val contentRoute = payload.getValue("api").jsonArray.map {it.jsonObject}.firstOrNull {
            it.getValue("method").jsonPrimitive.content == "POST" &&
                it.getValue("path").jsonPrimitive.content == "/v1/bookmark/content" &&
                it["requestBody"]?.jsonObject?.get("bookmark_uid")?.jsonPrimitive?.content == bookmarkId
        }
        val status = contentRoute?.getValue("status")?.jsonPrimitive?.int
        val uncached = payload.getValue("cache").jsonArray.none {it.jsonObject.getValue("key").jsonPrimitive.content == state.cacheKey}
        val expectedError = if (uncached && !connected) "No network connection" to "This article is not cached on this device"
            else if (uncached && status != null && status != 200 && status != 204) "Error code: $status" to (contentRoute?.get("json")?.jsonObject?.get("message")?.jsonPrimitive?.content ?: "Error: $status")
            else null
        if (expectedError != null) {
            // Never substitute a timeout or an unexpected fallback page for the
            // prepared error case. Verify the actual source terminal DOM text.
            if (!html.contains("slax-reader-notfound-container")) {readinessBlockReason = "expected-terminal-error-html-missing"; return false}
            readinessBlockReason = "terminal-error-await-actual-dom-probe"
            val reason = Json.encodeToString(expectedError.first)
            val detail = Json.encodeToString(expectedError.second)
            // The unchanged source wraps these strings in <center> inside <p>.
            // HTML5 parsing closes the paragraph before that center element.
            return probeDocument(html, """(function(){var root=document.querySelector('.slax-reader-notfound-container');if(document.readyState==='loading'||!root)return false;var texts=Array.from(root.querySelectorAll('center')).map(function(node){return node.textContent.trim();}),detail=root.querySelector('.notfound-reason .detail');return Boolean(root.querySelector('.notfound-p')&&detail&&texts.length===3&&texts[0]==='Failed to load content'&&texts[1]===$reason&&texts[2]===$detail&&detail.textContent.trim()===$detail&&root.querySelector('.retry-btn'));})()""")
        }
        readinessBlockReason = "bookmark-await-actual-dom-probe"
        return probeDocument(html, "Boolean(document.readyState !== 'loading' && window.SlaxWebViewBridge && window.SlaxWebViewBridge.markManager)")
    }

    /** Read-only rejection evidence from synthetic fixtures; never turns a timeout into acceptance. */
    fun readinessDiagnostics(): JsonObject = synchronized(readinessLock) {
        val content = viewModel.contentState.value
        val rss = rssViewModel?.state?.value
        buildJsonObject {
            put("kind", "source-reader-readiness-rejection"); put("controlledFixture", true); put("fixtureVersion", 1)
            put("blockReason", readinessBlockReason); put("closed", closed)
            put("bookmarkCacheKey", content.cacheKey); put("bookmarkLoading", content.isLoading)
            put("bookmarkHtmlLength", content.htmlContent?.length ?: 0)
            put("nativeHtmlLength", documentHtml?.length ?: 0); put("nativeWebStatePresent", webState != null)
            put("bookmarkHtmlHasTerminalError", content.htmlContent?.contains("slax-reader-notfound-container") == true)
            put("currentLocalDownloadStatus", downloadStatus.value[content.cacheKey]?.downloadStatus?.let {JsonPrimitive(it)} ?: JsonNull)
            put("readerHttp", fixtureHttp.diagnostics())
            put("fixtureImageRequestCount", FixtureReaderResources.requestCount)
            // Read only the concrete source connectivity provider's replay. Do
            // not query another status or inject a replacement coordinator.
            val networkReplay = runCatching {
                val field = coordinator.javaClass.getDeclaredField("connectivity").apply {isAccessible = true}
                (field.get(coordinator) as Connectivity).statusUpdates.replayCache.lastOrNull()
            }.getOrNull()
            put("concreteNetworkReplay", when (networkReplay) {
                is Connectivity.Status.Connected -> "connected"
                is Connectivity.Status.Disconnected -> "disconnected"
                else -> "no-replayed-platform-status"
            })
            put("expectedUserId", expectedUserId); put("actualUserId", viewModel.userInfo.value?.id ?: "")
            put("expectedSubscriptionEnd", expectedSubscriptionEnd ?: ""); put("actualSubscriptionEnd", viewModel.subscriptionInfo.value?.subscription_end_time ?: "")
            put("rssEntryId", rss?.entry?.id ?: ""); put("rssBusy", rss?.busy ?: false); put("rssError", rss?.error ?: "")
            put("probeGeneration", readinessGeneration); put("probePending", readinessPending); put("probeReady", readinessReady)
            put("probePendingMilliseconds", if (readinessPending) (System.nanoTime() - readinessPendingSince) / 1_000_000L else 0L)
            put("lastActualProbeResult", readinessLastProbeValue ?: "no-native-callback")
            put("lastActualDomResult", readinessLastDomValue ?: "no-native-callback")
            put("nativeInteractionVerified", false)
        }
    }

    /** Return promptly so Compose's test clock can dispatch the source command collector. */
    private fun probeDocument(html: String, script: String): Boolean = synchronized(readinessLock) {
        val state = webState ?: return@synchronized false
        if (closed) return@synchronized false
        if (state !== readinessState || html != readinessHtml || script != readinessScript) {
            readinessGeneration++
            readinessState = state; readinessHtml = html; readinessScript = script
            readinessPending = false; readinessReady = false
            readinessLastProbeValue = null; readinessLastDomValue = null
        }
        if (readinessReady) return@synchronized true
        // A command issued just before the source SharedFlow collector attaches
        // can be lost. Retry its probe without accepting a timeout as readiness.
        if (!readinessPending || System.nanoTime() - readinessPendingSince >= 1_000_000_000L) {
            val generation = ++readinessGeneration
            readinessPending = true; readinessPendingSince = System.nanoTime()
            state.evaluateJsWithCallback(script) { result ->
                synchronized(readinessLock) {
                    if (!closed && generation == readinessGeneration && webState === state) {
                        readinessLastProbeValue = result.take(256)
                        readinessPending = false
                        readinessReady = result == "true"
                    }
                }
            }
            // The native callback itself is evidence. This bounded observation
            // cannot initialize the bridge, scroll, select or change the page.
            state.evaluateJsWithCallback("""(function(){var r=document.querySelector('.slax-reader-notfound-container');return JSON.stringify({readyState:document.readyState,bridge:Boolean(window.SlaxWebViewBridge),markManager:Boolean(window.SlaxWebViewBridge&&window.SlaxWebViewBridge.markManager),notfound:Boolean(r),centerTexts:r?Array.from(r.querySelectorAll('center')).map(function(n){return n.textContent.trim().slice(0,160);}):[],bodyText:document.body?document.body.innerText.slice(0,512):'',retry:Boolean(r&&r.querySelector('.retry-btn'))});})()""") { result ->
                synchronized(readinessLock) {
                    if (!closed && generation == readinessGeneration && webState === state) readinessLastDomValue = result.take(2048)
                }
            }
        }
        false
    }

    /** Prepare a real source DOM state; this is not evidence of native touch/handle gestures. */
    suspend fun prepareAction(action: JsonObject): Boolean {
        when (val kind = action.getValue("kind").jsonPrimitive.content) {
            "save-rss" -> {
                val model = checkNotNull(rssViewModel) {"Only the original RSS reader can prepare RSS save"}
                model.save()
                withTimeout(10_000) {model.state.first {!it.busy && (it.entry?.bookmark_user_uuid != null || it.error != null)}}
            }
            "open-overview" -> viewModel.overlayDelegate.showOverlay(BookmarkOverlay.Overview)
            "open-outline" -> viewModel.onToolbarIconClick("summary")
            "generate-overview" -> {viewModel.overviewDelegate.reset(); viewModel.overviewDelegate.loadOverview(params.getValue("bookmarkId").jsonPrimitive.content, payload.getValue("network").jsonObject.getValue("isConnected").jsonPrimitive.boolean)}
            "generate-outline" -> {viewModel.outlineDelegate.reset(); viewModel.outlineDelegate.loadOutline(params.getValue("bookmarkId").jsonPrimitive.content, payload.getValue("network").jsonObject.getValue("isConnected").jsonPrimitive.boolean)}
            "background-flush" -> {viewModel.flushReadPosition(); viewModel.flushOutlineScrollPosition()}
            "scroll" -> {
                val anchor = action.getValue("target").jsonPrimitive.content
                check(anchor.startsWith('#'))
                evaluate("(function(){window.SlaxWebViewBridge.scrollToAnchor(${Json.encodeToString(anchor.drop(1))});return true;})()")
            }
            "selection", "open-comment", "open-image" -> {
                val prepared = if (kind == "open-comment") buildJsonObject {
                    action.forEach { (key, value) -> if (key != "markId") put(key, value) }
                    put("markId", action.getValue("markId").jsonPrimitive.content.toStableId())
                } else action
                val encoded = prepared.toString()
                val result = evaluate("""(function(){try{var a=$encoded,b=window.SlaxWebViewBridge;if(a.kind==='selection'){var ns=a.source.flatMap(function(p){return b.markManager.renderer.transferNodeInfos(p);});if(!ns.length||ns.some(function(n){return n.type!=='text';}))throw Error('Unresolved source fixture range');var r=document.createRange();r.setStart(ns[0].node,ns[0].start);r.setEnd(ns[ns.length-1].node,ns[ns.length-1].end);if(a.selectedText!==undefined&&r.toString()!==a.selectedText)throw Error('Source fixture text mismatch');window.getSelection().removeAllRanges();window.getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));}else if(a.kind==='open-comment'){b.clearSelection();var g=b.markManager.markItemInfos.find(function(i){return i.comments.some(function(c){return c.markId===a.markId;});});var m=g&&Array.from(document.querySelectorAll('slax-mark[data-uuid]')).find(function(e){return e.dataset.uuid===g.id;});if(!m)throw Error('Unresolved source fixture mark');var s=new Event('touchstart',{bubbles:true});Object.defineProperty(s,'touches',{value:[{clientX:0,clientY:0}]});var e=new Event('touchend',{bubbles:true});Object.defineProperty(e,'changedTouches',{value:[{clientX:0,clientY:0}]});m.dispatchEvent(s);m.dispatchEvent(e);}else{var img=document.getElementById(a.imageId);if(!img||img.tagName!=='IMG')throw Error('Unresolved source fixture image');img.click();}return 'ok';}catch(e){return 'error:'+e.message;}})()""")
                check(result == "\"ok\"") { "Source DOM fixture preparation failed: $result" }
            }
            // No player events, provider success, network streams, or native exits are fabricated.
            else -> return false
        }
        return true
    }

    /** The instrumentation poll must not block Compose's frame clock waiting for a JS callback. */
    fun beginAction(action: JsonObject): Boolean = synchronized(readinessLock) {
        if (action.getValue("kind").jsonPrimitive.content !in setOf("open-overview", "open-outline", "generate-overview", "generate-outline", "background-flush", "scroll", "selection", "open-comment", "open-image", "save-rss")) return@synchronized false
        check(!closed && (actionJob == null || actionDone)) {"A source reader fixture action is already pending or closed"}
        val generation = ++actionGeneration
        actionDone = false; actionFailure = null
        actionJob = scope.launch(Dispatchers.Main) {
            val failure = runCatching {check(prepareAction(action))}.exceptionOrNull()
            synchronized(readinessLock) {
                if (!closed && actionGeneration == generation) {actionFailure = failure; actionDone = true}
            }
        }
        true
    }

    fun isActionComplete(): Boolean = synchronized(readinessLock) {
        actionFailure?.let {throw IllegalStateException("Source reader fixture preparation failed", it)}
        !closed && actionDone
    }

    fun close() {
        subscriptionJob.cancel()
        userJob.cancel()
        rssViewModel?.viewModelScope?.cancel()
        synchronized(readinessLock) {
            closed = true; readinessGeneration++
            actionGeneration++; actionJob?.cancel(); actionJob = null
            actionDone = false; actionFailure = null
            webState = null; documentHtml = null; readinessState = null; readinessHtml = null; readinessScript = null
            readinessPending = false; readinessReady = false
            readinessLastProbeValue = null; readinessLastDomValue = null
        }
        fixtureHttp.close()
    }

    private suspend fun evaluate(script: String): String = withTimeout(5_000) {
        val state = webState ?: return@withTimeout "false"
        suspendCancellableCoroutine { continuation ->
            state.evaluateJsWithCallback(script) { value -> if (continuation.isActive) continuation.resume(value) }
        }
    }
}
