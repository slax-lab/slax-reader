package com.slax.reader.fixtures

import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Build
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.ViewModelStore
import androidx.navigation.compose.rememberNavController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.powersync.DatabaseDriverFactory
import com.powersync.PowerSyncDatabase
import com.powersync.db.getString
import com.slax.reader.data.database.AppSchema
import com.slax.reader.data.database.dao.*
import com.slax.reader.data.database.model.BookmarkSortType
import com.slax.reader.data.file.FileManager
import com.slax.reader.data.network.ApiService
import com.slax.reader.data.network.RssRepository
import com.slax.reader.data.preferences.AppPreferences
import com.slax.reader.domain.auth.AuthDomain
import com.slax.reader.domain.auth.AuthGateway
import com.slax.reader.domain.auth.GoogleSignInResult
import com.slax.reader.domain.auth.AppleSignInResult
import com.slax.reader.const.InboxRoutes
import com.slax.reader.ui.login.LoginScreen
import com.slax.reader.ui.login.LoginViewModel
import com.slax.reader.ui.bookmark.BookmarkDetailViewModel
import com.slax.reader.domain.image.ImageDownloadManager
import com.slax.reader.domain.coordinator.AppSyncState
import com.slax.reader.domain.coordinator.NetworkCoordinator
import com.slax.reader.ui.about.AboutScreen
import com.slax.reader.ui.feedback.FeedbackScreen
import com.slax.reader.ui.inbox.InboxListScreen
import com.slax.reader.ui.inbox.InboxListViewModel
import com.slax.reader.ui.rss.RssViewModel
import com.slax.reader.ui.setting.RssSettingsViewModel
import com.slax.reader.ui.setting.SettingScreen
import com.slax.reader.ui.setting.SettingViewModel
import com.slax.reader.ui.sidebar.SidebarViewModel
import com.slax.reader.utils.FirstPartyEventReporter
import com.slax.reader.utils.LocaleString
import com.slax.reader.utils.i18n
import io.ktor.client.HttpClient
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import okio.FileSystem
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module
import java.io.File
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/** Actual source Compose screens/DAOs. Unsupported source routes fail rather than draw substitutes. */
class SourceReferenceFixtureTest {
    @get:Rule val rule = createAndroidComposeRule<SourceFixtureActivity>()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val arguments = InstrumentationRegistry.getArguments()
    private val visible = mutableStateOf(true)
    private val store = ViewModelStore()
    private val daoScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var context: Context
    private lateinit var database: PowerSyncDatabase
    private lateinit var http: HttpClient
    private lateinit var filename: String
    private lateinit var scenario: JsonObject
    private lateinit var payload: JsonObject
    private lateinit var output: File
    private lateinit var inputSha256: String
    private lateinit var captureInputs: JsonObject
    private lateinit var name: String
    private lateinit var locale: String
    private lateinit var rss: RssViewModel
    private var reader: SourceReaderAdapter? = null
    private var initialLibraryReady: () -> Boolean = {false}
    private var initialLibraryTitle: String? = null
    private var startedKoin = false

    @Before fun setup() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        check(context.packageName == "com.slax.reader.fixture" || context.packageName.startsWith("com.slax.reader.fixture."))
        check(context.checkSelfPermission(android.Manifest.permission.INTERNET) == PackageManager.PERMISSION_DENIED) {
            "The source fixture target must remove INTERNET permission, including merged dependency manifests"
        }
        name = arguments.getString("fixtureCase") ?: "library-populated"
        locale = arguments.getString("fixtureLocale") ?: "en"
        check(name.matches(Regex("[a-z0-9-]+")) && locale in listOf("en", "zh"))
        val assets = instrumentation.context.assets
        val bytes = assets.open("slax-ui-fixtures/scenarios.json").use { it.readBytes() }
        inputSha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
        captureInputs = Json.parseToJsonElement(assets.open("slax-ui-fixtures/source-capture-inputs.json").bufferedReader().use { it.readText() }).jsonObject
        check(captureInputs.getValue("fixtureInputSha256").jsonPrimitive.content == inputSha256)
        check(listOf("sourceManifestSha256", "actionDriverSha256").all {captureInputs.getValue(it).jsonPrimitive.content.matches(Regex("[a-f0-9]{64}"))})
        val manifest = Json.parseToJsonElement(assets.open("slax-ui-fixtures/manifest.json").bufferedReader().use { it.readText() }).jsonObject
        check(manifest.getValue("files").jsonArray.any { it.jsonObject["path"]?.jsonPrimitive?.content == "scenarios.json" && it.jsonObject["sha256"]?.jsonPrimitive?.content == inputSha256 })
        val bundle = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
        check(bundle.getValue("synthetic").jsonPrimitive.boolean && bundle.getValue("schemaVersion").jsonPrimitive.int == 1)
        scenario = bundle.getValue("scenarios").jsonObject.getValue(name).jsonObject
        payload = scenario.getValue("payload").jsonObject
        val route = scenario.getValue("route").jsonObject.getValue("name").jsonPrimitive.content
        check(route in listOf("Library", "Settings", "Feedback", "About", "Login", "Reader") && payload["upgrade"] == null) {
            "Source adapter does not support this route yet: $route; native acceptance remains pending"
        }
        output = File(context.getExternalFilesDir("captures"), "$name-${UUID.randomUUID()}").apply { check(mkdirs()) }
        File(output, "slax-fixture.json").writeText(buildJsonObject { put("controlledFixture", true); put("fixtureVersion", 1); put("inputSha256", inputSha256) }.toString())
        check(FirebaseApp.getApps(context).isEmpty()) { "The isolated source runner must not initialize Firebase" }
        filename = "ui-fixture-${UUID.randomUUID()}.db"
        database = PowerSyncDatabase(DatabaseDriverFactory(context), AppSchema, filename)
        seedDatabase()
        val prefs = AppPreferences(FixturePreferences(payload, locale))
        val api = FixtureApi(payload)
        http = fixtureDisabledHttp()
        val users = UserDao(daoScope, database)
        val bookmarks = BookmarkDao(daoScope, database)
        val collections = CollectionDao(daoScope, database)
        val local = LocalBookmarkDao(daoScope, database)
        val subscriptions = SubscriptionDao(daoScope, database)
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
        // Override only the declared synchronization input. All row queries and
        // mutations still delegate to the unchanged source DAO/database.
        val inboxBookmarks = object : BookmarkRepository by bookmarks {
            override val hasSynced = MutableStateFlow(sync.getValue("hasSynced").jsonPrimitive.boolean)
        }
        val inbox = InboxListViewModel(users, inboxBookmarks, collections, local, coordinator)
        val preparedDatabase = payload.getValue("database").jsonObject
        val expectedRows = preparedDatabase.getValue("sr_user_bookmark").jsonArray.map {it.jsonObject}
            .filter {it.getValue("archive_status").jsonPrimitive.int == 0 && it["deleted_at"] == JsonNull}
            .map {it.getValue("id").jsonPrimitive.content}.toSet()
        initialLibraryTitle = preparedDatabase.getValue("sr_user_bookmark").jsonArray.map {it.jsonObject}
            .firstOrNull {it.getValue("id").jsonPrimitive.content in expectedRows}?.let {row ->
                row.getValue("alias_title").jsonPrimitive.content.takeIf {it.isNotBlank()}
                    ?: Json.parseToJsonElement(row.getValue("metadata").jsonPrimitive.content).jsonObject.getValue("bookmark").jsonObject.getValue("title").jsonPrimitive.content
            }
        val expectedDownloads = preparedDatabase.getValue("ps_data_local__local_bookmark_info").jsonArray.associate {raw ->
            val row = raw.jsonObject
            row.getValue("id").jsonPrimitive.content to (Json.parseToJsonElement(row.getValue("data").jsonPrimitive.content).jsonObject["is_downloaded"]?.jsonPrimitive?.int ?: 0)
        }
        val expectedCollections = preparedDatabase.getValue("sr_user_collection_subscriber").jsonArray
            .map {it.jsonObject.getValue("collection_id").jsonPrimitive.content}.toSet()
        initialLibraryReady = {
            val rows = inbox.bookmarks.value
            bookmarks.watchUserBookmarkPaged(BookmarkSortType.UPDATED).value != null &&
                rows.map {it.id}.toSet() == expectedRows &&
                rows.all {it.downloadStatus == (expectedDownloads[it.id] ?: 0)} &&
                inbox.subscribedCollections.value.map {it.id}.toSet() == expectedCollections
        }
        val sidebar = SidebarViewModel(users, coordinator, subscriptions)
        val reporter = FirstPartyEventReporter(http, prefs)
        if (route == "Reader") reader = SourceReaderAdapter(context, assets, scenario, database, prefs, http, daoScope, reporter, subscriptionDao = subscriptions, userDao = users)
        val auth = AuthDomain(prefs, ApiService(http), FileManager(FileSystem.SYSTEM))
        rss = RssViewModel(RssRepository(api), auth, bookmarks)
        val settings = SettingViewModel(api, prefs)
        val rssSettings = RssSettingsViewModel(api)
        val login = LoginViewModel(object : AuthGateway {
            override suspend fun signIn(code: String, type: String, redirectUrl: String, idToken: String): Result<Unit> {
                val result = api.response("POST", "/v1/user/login").getValue("data").jsonObject
                prefs.setAuthInfo(result.getValue("token").jsonPrimitive.content, result.getValue("user_id").jsonPrimitive.content)
                return Result.success(Unit)
            }
        })
        val agreementDocuments = listOf("terms", "privacy").associate { key -> "/$key" to assets.open("slax-ui-fixtures/articles/$key.html").bufferedReader().use { it.readText() } }
        val webViewHost = FixtureWebViewHost(agreementDocuments)
        startKoin { modules(module {
            single<Context> { context }; single<AppPreferences> { prefs }; single<InboxListViewModel> { inbox }
            single<SidebarViewModel> { sidebar }; single<AuthDomain> { auth }; single<FirstPartyEventReporter> { reporter }
            viewModel<RssViewModel> { rss }
            reader?.let { adapter -> viewModel<BookmarkDetailViewModel> { adapter.viewModel }; single<ImageDownloadManager> { adapter.imageDownloadManager } }
        }) }
        startedKoin = true
        rule.runOnIdle {
            listOf(inbox, sidebar, auth, rss, settings, rssSettings, login).forEachIndexed { index, vm -> store.put("fixture-$index", vm) }
            reader?.let { store.put("fixture-reader", it.viewModel) }
            LocaleString.currentLocale = locale
        }
        rule.setContent {
            if (visible.value) {
                val nav = rememberNavController()
                when (route) {
                    "Reader" -> reader!!.Render { event -> error("Source fixture navigation requires a native action driver: $event") }
                    "Login" -> NavHost(nav, startDestination = "fixture-login") {
                        composable("fixture-login") { LoginScreen(nav, login, webViewHost = webViewHost, showAppleSignIn = false,
                            googleSignIn = { val plan = payload.getValue("authentication").jsonObject; delay(plan.getValue("delayMs").jsonPrimitive.long); when (plan.getValue("outcome").jsonPrimitive.content) {
                                "cancel" -> Result.failure(IllegalStateException("cancelled synthetic provider"))
                                "error" -> Result.failure(IllegalStateException(plan.getValue("message").jsonPrimitive.content))
                                "success" -> Result.success(GoogleSignInResult("fixture-identity-token-unusable"))
                                else -> error("Unprepared synthetic provider outcome")
                            } }, appleSignIn = { Result.failure<AppleSignInResult>(IllegalStateException("Android source has no Apple sign-in")) }) }
                        composable<InboxRoutes> { InboxListScreen(nav, inbox, sidebar) }
                    }
                    "Library" -> InboxListScreen(nav, inbox, sidebar)
                    "Settings" -> SettingScreen({}, nav, settings, rssSettings)
                    "About" -> AboutScreen({}, {})
                    "Feedback" -> {
                        val params = scenario.getValue("route").jsonObject["params"]?.jsonObject
                        FeedbackScreen(title = params?.get("title")?.jsonPrimitive?.content, href = params?.get("targetUrl")?.jsonPrimitive?.content,
                            email = "reader@example.test", bookmarkId = params?.get("bookmarkId")?.jsonPrimitive?.content,
                            entryPoint = params?.get("entryPoint")?.jsonPrimitive?.content, version = "fixture (1)", onBackClick = {}, api = api)
                    }
                }
            }
        }
    }

    private suspend fun seedDatabase() {
        val allowedTables = setOf("sr_user", "sr_user_tag", "sr_user_bookmark", "sr_bookmark_comment", "sr_user_subscription", "sr_user_collection", "sr_user_collection_subscriber", "sr_collection_bookmark", "sr_sharer_setting", "ps_data_local__local_bookmark_info")
        payload.getValue("database").jsonObject.forEach { (table, rows) ->
            check(table in allowedTables)
            val columns = database.getAll("PRAGMA table_info(\"$table\")") { it.getString("name") }.toSet()
            rows.jsonArray.forEach { raw ->
                val row = raw.jsonObject
                check(row.keys.all { it.matches(Regex("[a-z_]+")) && it in columns })
                val keys = row.keys.toList()
                val values = keys.map { key -> val value = row.getValue(key); when {
                    value == JsonNull -> null
                    value.jsonPrimitive.isString -> value.jsonPrimitive.content
                    value.jsonPrimitive.booleanOrNull != null -> if (value.jsonPrimitive.boolean) 1 else 0
                    else -> value.jsonPrimitive.long
                } }
                database.execute("INSERT OR REPLACE INTO \"$table\" (${keys.joinToString { "\"$it\"" }}) VALUES (${keys.joinToString { "?" }})", values)
            }
        }
    }

    @Test fun captureSourceFrames() {
        if (scenario.getValue("route").jsonObject.getValue("name").jsonPrimitive.content == "Library") rule.waitUntil(10_000) { rss.state.value.ready && initialLibraryReady() }
        if (scenario.getValue("route").jsonObject.getValue("name").jsonPrimitive.content == "Library") initialLibraryTitle?.let {title ->
            rule.waitUntil(10_000) {rule.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty()}
            rule.onNodeWithText(title).assertIsDisplayed()
        }
        rule.waitForIdle()
        reader?.let { adapter -> rule.waitUntil(15_000) { runBlocking { adapter.isDocumentReady() } } }
        capture(0, "initial")
        val initialOnly = arguments.getString("fixtureInitialOnly")
        check(initialOnly == null || initialOnly in listOf("true", "false")) {"Invalid initial-only capture option"}
        if (initialOnly == "true") return
        val requestedAction = arguments.getString("fixtureActionIndex")
        val actionIndex = requestedAction?.let {checkNotNull(it.toIntOrNull()) {"Invalid fixture action index"}}
        check(actionIndex == null || actionIndex in scenario.getValue("actions").jsonArray.indices) {"Unknown fixture action index"}
        scenario.getValue("actions").jsonArray.forEachIndexed { index, raw ->
            if (actionIndex != null && actionIndex != index) return@forEachIndexed
            val action = raw.jsonObject
            when (val kind = action.getValue("kind").jsonPrimitive.content) {
                "select-list" -> {
                    rule.onNodeWithContentDescription("Switch List").performClick()
                    val key = when (action.getValue("list").jsonPrimitive.content) { "rss" -> "rss_feeds"; "starred" -> "inbox_starred"; "archived" -> "inbox_archive"; else -> "inbox_title" }
                    rule.onNodeWithText(key.i18n()).performClick()
                }
                "select-source" -> {
                    val id = action.getValue("id").jsonPrimitive.content
                    val subscription = rss.state.value.subscriptions.single { it.id == id }
                    rule.onNodeWithText(subscription.remark?.takeIf { it.isNotBlank() } ?: subscription.title).performClick()
                }
                "load-history" -> {
                    val node = rule.onNodeWithText("rss_more".i18n())
                    if (action["expectDisabled"]?.jsonPrimitive?.boolean == true) node.assertIsNotEnabled() else node.performClick()
                }
                "source-menu" -> rule.onNodeWithContentDescription("rss_source_menu".i18n()).performClick()
                "begin-login" -> { check(action.getValue("provider").jsonPrimitive.content == "google"); rule.onNodeWithText("login_google".i18n()).performClick() }
                "select-agreement" -> rule.onNodeWithText(("agreement_tab_" + action.getValue("agreement").jsonPrimitive.content).i18n()).performClick()
                "dismiss-agreement" -> rule.onNodeWithText("agreement_btn_disagree".i18n()).performClick()
                "accept-agreement" -> rule.onNodeWithText("agreement_btn_agree".i18n()).performClick()
                "type" -> rule.onNodeWithTag(action.getValue("testID").jsonPrimitive.content).performTextReplacement(action.getValue("text").jsonPrimitive.content)
                "press" -> rule.onNodeWithTag(action.getValue("testID").jsonPrimitive.content).performClick()
                else -> {
                    val adapter = checkNotNull(reader)
                    check(adapter.beginAction(action)) { "Source fixture action is not implemented: $kind" }
                    rule.waitUntil(7_000) { adapter.isActionComplete() }
                }
            }
            rule.waitUntil(10_000) { !rss.state.value.busy }
            if (name == "feedback-error" && action.getValue("kind").jsonPrimitive.content == "press") rule.waitUntil(10_000) {
                rule.onAllNodesWithText("feedback_error_title".i18n()).fetchSemanticsNodes().isNotEmpty()
            }
            rule.waitForIdle()
            capture(index + 1, action.getValue("kind").jsonPrimitive.content)
        }
    }

    private fun capture(index: Int, action: String) {
        instrumentation.waitForIdleSync()
        val automation = instrumentation.uiAutomation
        var foreground = automation.rootInActiveWindow?.packageName?.toString()
        val deadline = android.os.SystemClock.uptimeMillis() + 3_000
        while (foreground == null && android.os.SystemClock.uptimeMillis() < deadline) {
            Thread.sleep(100)
            foreground = automation.rootInActiveWindow?.packageName?.toString()
        }
        check(foreground == context.packageName) {"Native source window is obscured or unavailable: $foreground"}
        // Give the real display pipeline time to commit its settled Compose frame.
        // This does not prove gestures, animations or the correct visible state.
        Thread.sleep(250)
        val density = context.resources.displayMetrics.density
        val activity = rule.activity
        var safeArea: JsonObject? = null
        instrumentation.runOnMainSync {
            val insets = checkNotNull(activity.window.decorView.rootWindowInsets) {"Measured source window insets are unavailable"}
            safeArea = if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars())
                buildJsonObject {put("top", bars.top / density); put("bottom", bars.bottom / density); put("left", bars.left / density); put("right", bars.right / density)}
            } else buildJsonObject {put("top", insets.systemWindowInsetTop / density); put("bottom", insets.systemWindowInsetBottom / density); put("left", insets.systemWindowInsetLeft / density); put("right", insets.systemWindowInsetRight / density)}
        }
        val screenshot = instrumentation.uiAutomation.takeScreenshot() ?: error("Native source screenshot unavailable")
        val textNodes = rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Text), useUnmergedTree = true).fetchSemanticsNodes()
        val scrollNodes = rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange), useUnmergedTree = true).fetchSemanticsNodes()
        var measuredSemantics = JsonArray(emptyList())
        var observedScrollRanges = JsonArray(emptyList())
        instrumentation.runOnMainSync {
            measuredSemantics = buildJsonArray { textNodes.forEach {node ->
                val bounds = node.boundsInRoot
                add(buildJsonObject {
                    put("text", node.config[SemanticsProperties.Text].joinToString("\n") {it.text})
                    put("leftPixels", bounds.left); put("topPixels", bounds.top)
                    put("widthPixels", bounds.width); put("heightPixels", bounds.height)
                })
            }}
            observedScrollRanges = buildJsonArray { scrollNodes.forEach {node ->
                val range = node.config[SemanticsProperties.VerticalScrollAxisRange]
                val bounds = node.boundsInRoot
                add(buildJsonObject {
                    put("valuePixels", range.value()); put("maxPixels", range.maxValue())
                    put("leftPixels", bounds.left); put("topPixels", bounds.top)
                    put("widthPixels", bounds.width); put("heightPixels", bounds.height)
                })
            }}
        }
        File(output, "%02d-%s.png".format(index, action)).outputStream().use { stream -> check(screenshot.compress(Bitmap.CompressFormat.PNG, 100, stream)) }
        File(output, "%02d-%s.json".format(index, action)).writeText(buildJsonObject {
            put("controlledFixture", true); put("fixtureVersion", 1); put("scenario", name); put("inputSha256", inputSha256)
            captureInputs.forEach {(key, value) -> put(key, value)}
            put("locale", locale); put("platform", "android"); put("osVersion", Build.VERSION.RELEASE); put("sdk", Build.VERSION.SDK_INT)
            put("deviceModel", Build.MODEL); put("systemClockSample", SimpleDateFormat("HH:mm", Locale.ROOT).format(Date()))
            put("displayedClock", "pending-native-frame-inspection")
            put("appearance", if (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES) "dark" else "light")
            put("safeArea", checkNotNull(safeArea)); put("captureMethod", "android-ui-automation")
            put("widthPixels", screenshot.width); put("heightPixels", screenshot.height); put("density", context.resources.displayMetrics.density)
            put("fontScale", context.resources.configuration.fontScale); put("fontScaleProfile", if (context.resources.configuration.fontScale > 1f) "accessibility-enlarged" else "default"); put("capturedAtMillis", System.currentTimeMillis())
            put("simulatedNetworkAndSync", true); put("visualComparison", "unverified"); put("nativeInteractionVerified", false)
            put("measuredTextSemantics", measuredSemantics); put("observedVerticalScrollRanges", observedScrollRanges)
            put("sourceReaderAdapter", if (reader != null) "original-source-reader-with-prepared-inputs" else "not-used")
            reader?.let {put("lifecyclePreparation", it.lifecyclePreparation)}
            arguments.getString("fixtureActionIndex")?.let { put("isolatedActionIndex", it.toInt()) }
            put("initialOnlyRequested", arguments.getString("fixtureInitialOnly") == "true")
        }.toString())
        screenshot.recycle()
    }

    @After fun cleanup() {
        rule.runOnIdle { visible.value = false; store.clear() }
        rule.waitForIdle()
        reader?.close()
        daoScope.cancel()
        if (::http.isInitialized) http.close()
        if (::database.isInitialized) runBlocking { database.close(); context.deleteDatabase(filename) }
        if (startedKoin) stopKoin()
    }
}
