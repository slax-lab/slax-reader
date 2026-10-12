@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
package com.slax.reader.fixtures

import androidx.compose.foundation.ComposeFoundationFlags
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.window.ComposeUIViewController
import androidx.navigation.compose.*
import com.powersync.DatabaseDriverFactory
import com.powersync.PowerSyncDatabase
import com.powersync.db.getString
import com.slax.reader.const.InboxRoutes
import com.slax.reader.data.database.AppSchema
import com.slax.reader.data.database.dao.*
import com.slax.reader.data.database.model.BookmarkSortType
import com.slax.reader.data.file.FileManager
import com.slax.reader.data.network.ApiService
import com.slax.reader.data.network.RssRepository
import com.slax.reader.data.preferences.AppPreferences
import com.slax.reader.data.preferences.fixturePreferences
import com.slax.reader.domain.auth.*
import com.slax.reader.domain.coordinator.*
import com.slax.reader.domain.image.ImageDownloadManager
import com.slax.reader.ui.about.AboutScreen
import com.slax.reader.ui.bookmark.BookmarkDetailViewModel
import com.slax.reader.ui.feedback.FeedbackScreen
import com.slax.reader.ui.inbox.*
import com.slax.reader.ui.login.*
import com.slax.reader.ui.rss.RssViewModel
import com.slax.reader.ui.setting.*
import com.slax.reader.ui.sidebar.SidebarViewModel
import com.slax.reader.utils.FirstPartyEventReporter
import com.slax.reader.utils.LocaleString
import com.slax.reader.utils.NavigationHelper
import io.ktor.client.HttpClient
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import okio.FileSystem
import okio.Path.Companion.toPath
import platform.Foundation.NSBundle
import platform.Foundation.NSUUID
import platform.UIKit.UIColor
import platform.UIKit.UINavigationController
import platform.UIKit.UIViewController
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

private const val IDENTITY = "app.slax.reader.sourcefixture"
private var mountedSession: SourceSession? = null

/** UIKit calls this only after compiling the native WK network blocking rule. */
fun SourceFixtureViewController(scenarioName: String, locale: String, actionIndex: Int): UIViewController {
    check(NSBundle.mainBundle.bundleIdentifier == IDENTITY)
    check(locale in listOf("en", "zh") && scenarioName.matches(Regex("[a-z0-9-]+")))
    fixtureWebRules()
    ComposeFoundationFlags.isNewContextMenuEnabled = true
    val controller = ComposeUIViewController {
        var prepared by remember {mutableStateOf<SourceSession?>(null)}
        var failure by remember {mutableStateOf<String?>(null)}
        LaunchedEffect(scenarioName, locale, actionIndex) {
            runCatching {SourceSession.prepare(scenarioName, locale, actionIndex)}
                .onSuccess {prepared = it; mountedSession = it}
                .onFailure {
                    // All inputs and credentials in this separate fixture app are synthetic.
                    // Keep the complete setup cause in its own console, without changing source handlers.
                    it.printStackTrace()
                    failure = it.message ?: "Original source fixture setup failed"
                    writeStatus("failed", failure!!, buildJsonObject {
                        put("setupCauseTypes", buildJsonArray {
                            var cause: Throwable? = it
                            repeat(8) {cause?.let {current -> add(current::class.simpleName ?: "Throwable"); cause = current.cause}}
                        })
                    })
                }
        }
        val session = prepared
        if (session != null) {
            DisposableEffect(session) {onDispose {session.close(); if (mountedSession === session) mountedSession = null}}
            session.Render()
            LaunchedEffect(session) {session.awaitPreparedState()}
        } else if (failure != null) Text(failure!!)
    }
    controller.extendedLayoutIncludesOpaqueBars = false
    return UINavigationController(rootViewController = controller).also {
        it.view.backgroundColor = UIColor.whiteColor
        it.setNavigationBarHidden(true, false)
        it.interactivePopGestureRecognizer?.delegate = null
        it.interactivePopGestureRecognizer?.setEnabled(true)
        NavigationHelper.setNavigationController(it)
    }
}

fun closeSourceFixture() {mountedSession?.close(); mountedSession = null}

private fun loadAsset(path: String): ByteArray {
    check(path.matches(Regex("(?:[a-z0-9-]+/)*[a-z0-9-]+\\.(?:json|html|ts)")))
    val root = checkNotNull(NSBundle.mainBundle.resourcePath)
    return FileSystem.SYSTEM.read("$root/slax-ui-fixtures/$path".toPath()) {readByteArray()}
}
private fun writeStatus(state: String, message: String = "", extra: JsonObject = buildJsonObject {}) {
    FileManager(FileSystem.SYSTEM).writeDataFile("fixture-status.json", buildJsonObject {
        put("controlledFixture", true); put("fixtureVersion", 1); put("state", state); put("message", message)
        extra.forEach {(key, value) -> put(key, value)}
        put("nativeInteractionVerified", false)
    }.toString().encodeToByteArray())
}

/** Only storage, request results and the initial route are injected; source screen implementations remain unchanged. */
private class SourceSession(
    private val scenario: JsonObject, private val payload: JsonObject, private val name: String, private val locale: String,
    private val actionIndex: Int, private val database: PowerSyncDatabase, private val http: HttpClient,
    private val scope: CoroutineScope, private val inbox: InboxListViewModel, private val sidebar: SidebarViewModel,
    private val rss: RssViewModel, private val settings: SettingViewModel, private val rssSettings: RssSettingsViewModel,
    private val login: LoginViewModel, private val api: FixtureApi, private val reader: SourceReaderAdapter?,
    private val webHost: FixtureWebViewHost,
) {
    private val route = scenario.getValue("route").jsonObject.getValue("name").jsonPrimitive.content
    private var closed = false

    @Composable fun Render() {
        val nav = rememberNavController()
        when (route) {
            "Reader" -> reader!!.Render {event -> error("Source native route action is not prepared: $event")}
            "Library" -> InboxListScreen(nav, inbox, sidebar)
            "Settings" -> SettingScreen({}, nav, settings, rssSettings)
            "About" -> AboutScreen({}, {})
            "Feedback" -> {
                val params = scenario.getValue("route").jsonObject["params"]?.jsonObject
                FeedbackScreen(title = params?.get("title")?.jsonPrimitive?.content, href = params?.get("targetUrl")?.jsonPrimitive?.content,
                    email = "reader@example.test", bookmarkId = params?.get("bookmarkId")?.jsonPrimitive?.content,
                    entryPoint = params?.get("entryPoint")?.jsonPrimitive?.content, version = "fixture (1)", onBackClick = {}, api = api)
            }
            "Login" -> NavHost(nav, startDestination = "fixture-login") {
                composable("fixture-login") {LoginScreen(nav, login, webViewHost = webHost, showAppleSignIn = true,
                    googleSignIn = {providerResult().map {GoogleSignInResult("fixture-identity-token-unusable")}},
                    appleSignIn = {providerResult().map {AppleSignInResult("fixture-apple-code-unusable", "fixture-identity-token-unusable")}})}
                composable<InboxRoutes> {InboxListScreen(nav, inbox, sidebar)}
            }
        }
    }
    private suspend fun providerResult(): Result<Unit> {
        val plan = payload.getValue("authentication").jsonObject
        delay(plan.getValue("delayMs").jsonPrimitive.long)
        return when (plan.getValue("outcome").jsonPrimitive.content) {
            "cancel" -> Result.failure(IllegalStateException("cancelled synthetic provider"))
            "error" -> Result.failure(IllegalStateException(plan.getValue("message").jsonPrimitive.content))
            "success" -> Result.success(Unit)
            else -> error("Unprepared synthetic provider outcome")
        }
    }
    suspend fun awaitPreparedState() {
        try {
            withTimeout(15_000) {
                if (reader != null) while (!reader.isDocumentReady()) delay(50)
                if (route == "Library") {
                    val expected = payload.getValue("database").jsonObject.getValue("sr_user_bookmark").jsonArray.map {it.jsonObject}
                        .filter {it.getValue("archive_status").jsonPrimitive.int == 0 && it["deleted_at"] == JsonNull}
                        .map {it.getValue("id").jsonPrimitive.content}.toSet()
                    while (!rss.state.value.ready || inbox.bookmarks.value.map {it.id}.toSet() != expected) delay(50)
                }
            }
            if (actionIndex >= 0) {
                val action = scenario.getValue("actions").jsonArray.getOrNull(actionIndex)?.jsonObject ?: error("Unprepared fixture action index")
                check(reader != null && reader.beginAction(action)) {"This source iOS action is not bound; acceptance remains pending"}
                withTimeout(7_000) {while (!reader.isActionComplete()) delay(50)}
                delay(400)
            }
            writeStatus("prepared", extra = buildJsonObject {
                put("scenario", name); put("locale", locale); put("selectedActionIndex", actionIndex)
                put("route", route); put("fixtureInputSha256", captureInputs.getValue("fixtureInputSha256"))
                put("sourceManifestSha256", captureInputs.getValue("sourceManifestSha256"))
                reader?.let {put("lifecyclePreparation", it.lifecyclePreparation)}
            })
        } catch (error: Throwable) {writeStatus("failed", error.message ?: "Source state did not become ready")}
    }
    fun close() {
        if (closed) return
        closed = true; reader?.close(); http.close()
        scope.launch {database.close()}.invokeOnCompletion {scope.cancel()}
        stopKoin()
    }
    companion object {
        private lateinit var captureInputs: JsonObject
        suspend fun prepare(name: String, locale: String, actionIndex: Int): SourceSession {
            val bundle = Json.parseToJsonElement(loadAsset("scenarios.json").decodeToString()).jsonObject
            check(bundle.getValue("synthetic").jsonPrimitive.boolean && bundle.getValue("schemaVersion").jsonPrimitive.int == 1)
            captureInputs = Json.parseToJsonElement(loadAsset("source-capture-inputs.json").decodeToString()).jsonObject
            val scenario = bundle.getValue("scenarios").jsonObject.getValue(name).jsonObject
            val payload = scenario.getValue("payload").jsonObject
            val route = scenario.getValue("route").jsonObject.getValue("name").jsonPrimitive.content
            check(route in listOf("Library", "Settings", "About", "Feedback", "Login", "Reader") && payload["upgrade"] == null) {"Unsupported original iOS route; native acceptance remains pending"}
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
            val database = PowerSyncDatabase(DatabaseDriverFactory(), AppSchema, "ui-fixture-${NSUUID().UUIDString}.db")
            seed(database, payload)
            val prefs = AppPreferences(FixturePreferences(payload, locale))
            fixturePreferences = prefs
            val api = FixtureApi(payload)
            val readerHttp = FixtureReaderHttp(payload)
            val http = readerHttp.client
            val users = UserDao(scope, database)
            val bookmarks = BookmarkDao(scope, database)
            val collections = CollectionDao(scope, database)
            val local = LocalBookmarkDao(scope, database)
            val subscriptions = SubscriptionDao(scope, database)
            val sync = payload.getValue("sync").jsonObject
            val network = payload.getValue("network").jsonObject
            val coordinator = object : NetworkCoordinator {
                override val syncState = MutableStateFlow<AppSyncState>(when {
                    !network.getValue("isConnected").jsonPrimitive.boolean -> AppSyncState.NoNetwork
                    sync.getValue("connected").jsonPrimitive.boolean -> AppSyncState.Connected
                    sync.getValue("downloading").jsonPrimitive.boolean -> AppSyncState.Downloading(0f)
                    sync.getValue("uploading").jsonPrimitive.boolean -> AppSyncState.Uploading
                    else -> AppSyncState.Connecting
                })
                override suspend fun isNetworkAvailable() = network.getValue("isConnected").jsonPrimitive.boolean
            }
            val inboxBookmarks = object : BookmarkRepository by bookmarks {override val hasSynced = MutableStateFlow(sync.getValue("hasSynced").jsonPrimitive.boolean)}
            val inbox = InboxListViewModel(users, inboxBookmarks, collections, local, coordinator)
            val sidebar = SidebarViewModel(users, coordinator, subscriptions)
            val reporter = FirstPartyEventReporter(http, prefs)
            val reader = if (route == "Reader") SourceReaderAdapter(::loadAsset, scenario, database, prefs, http, scope, reporter, subscriptions, users) else null
            val auth = AuthDomain(prefs, ApiService(http), FileManager(FileSystem.SYSTEM))
            val rss = RssViewModel(RssRepository(api), auth, bookmarks)
            val settings = SettingViewModel(api, prefs)
            val rssSettings = RssSettingsViewModel(api)
            val login = LoginViewModel(object : AuthGateway {
                override suspend fun signIn(code: String, type: String, redirectUrl: String, idToken: String): Result<Unit> {
                    val result = api.response("POST", "/v1/user/login").getValue("data").jsonObject
                    prefs.setAuthInfo(result.getValue("token").jsonPrimitive.content, result.getValue("user_id").jsonPrimitive.content)
                    return Result.success(Unit)
                }
            })
            val webHost = FixtureWebViewHost(listOf("terms", "privacy").associate {"/$it" to loadAsset("articles/$it.html").decodeToString()})
            startKoin {modules(module {
                single<AppPreferences> {prefs}; single<HttpClient> {reader?.httpClient ?: http}
                single<InboxListViewModel> {inbox}; single<SidebarViewModel> {sidebar}; single<AuthDomain> {auth}; single<FirstPartyEventReporter> {reporter}
                viewModel<RssViewModel> {rss}
                reader?.let {adapter -> viewModel<BookmarkDetailViewModel> {adapter.viewModel}; single<ImageDownloadManager> {adapter.imageDownloadManager}}
            })}
            // The unchanged LocaleString singleton injects AppPreferences during
            // initialization, just as it does after the original application starts Koin.
            LocaleString.currentLocale = locale
            writeStatus("loading")
            return SourceSession(scenario, payload, name, locale, actionIndex, database, http, scope, inbox, sidebar, rss, settings, rssSettings, login, api, reader, webHost)
        }
        private suspend fun seed(database: PowerSyncDatabase, payload: JsonObject) {
            val allowed = setOf("sr_user", "sr_user_tag", "sr_user_bookmark", "sr_bookmark_comment", "sr_user_subscription", "sr_user_collection", "sr_user_collection_subscriber", "sr_collection_bookmark", "sr_sharer_setting", "ps_data_local__local_bookmark_info")
            payload.getValue("database").jsonObject.forEach {(table, rows) ->
                check(table in allowed)
                val columns = database.getAll("PRAGMA table_info(\"$table\")") {it.getString("name")}.toSet()
                rows.jsonArray.forEach {raw ->
                    val row = raw.jsonObject
                    check(row.keys.all {it.matches(Regex("[a-z_]+")) && it in columns})
                    val keys = row.keys.toList()
                    val values = keys.map {key -> val value = row.getValue(key); when {
                        value == JsonNull -> null
                        value.jsonPrimitive.isString -> value.jsonPrimitive.content
                        value.jsonPrimitive.booleanOrNull != null -> if (value.jsonPrimitive.boolean) 1 else 0
                        else -> value.jsonPrimitive.long
                    }}
                    database.execute("INSERT OR REPLACE INTO \"$table\" (${keys.joinToString {"\"$it\""}}) VALUES (${keys.joinToString {"?"}})", values)
                }
            }
        }
    }
}
