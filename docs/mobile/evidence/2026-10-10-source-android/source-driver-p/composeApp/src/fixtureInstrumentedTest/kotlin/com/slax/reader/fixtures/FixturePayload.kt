package com.slax.reader.fixtures

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.slax.reader.data.network.AccountApi
import com.slax.reader.data.network.FeedbackApi
import com.slax.reader.data.network.RssApi
import com.slax.reader.data.network.dto.*
import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpSend
import io.ktor.client.plugins.plugin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

/** Source AppPreferences receives this memory store, never its platform datastore factory. */
class FixturePreferences(payload: JsonObject, locale: String) : DataStore<Preferences> {
    private val lock = Mutex()
    private val state = MutableStateFlow<Preferences>(emptyPreferences().toMutablePreferences().apply {
        payload.getValue("settings").jsonObject.forEach { (key, value) ->
            if (key == "cache_count" || key == "download_images") this[intPreferencesKey(key)] = value.jsonPrimitive.int
            else this[stringPreferencesKey(key)] = value.jsonPrimitive.content
        }
        val session = payload.getValue("session").jsonObject
        this[stringPreferencesKey("auth_token")] = session.getValue("token").jsonPrimitive.content
        this[stringPreferencesKey("user_id")] = session.getValue("userId").jsonPrimitive.content
        this[stringPreferencesKey("last_refresh_time")] = session.getValue("refreshedAt").jsonPrimitive.content
        this[stringPreferencesKey("user_language")] = locale
        this[stringPreferencesKey("analytics_device_id")] = "synthetic-ui-fixture"
    })
    override val data = state.asStateFlow()
    override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences = lock.withLock {
        transform(state.value).also { state.value = it }
    }
}

/** HTTP is forbidden even for background first-party event reporting and unused auth methods. */
fun fixtureDisabledHttp(): HttpClient = HttpClient().apply {
    plugin(HttpSend).intercept { throw IllegalStateException("Source UI fixture cannot use a native HTTP engine") }
}

class FixtureApi(private val payload: JsonObject) : RssApi, FeedbackApi, AccountApi {
    private val json = Json { ignoreUnknownKeys = true }
    suspend fun response(method: String, path: String, query: Map<String, String> = emptyMap()): JsonObject {
        check(payload.getValue("network").jsonObject.getValue("isConnected").jsonPrimitive.boolean) { "source_unavailable" }
        val candidates = payload.getValue("api").jsonArray.map { it.jsonObject }.filter { route ->
            route.getValue("method").jsonPrimitive.content == method && route.getValue("path").jsonPrimitive.content == path &&
                route.getValue("query").jsonObject.all { (key, value) -> query[key] == value.jsonPrimitive.content }
        }
        val route = candidates.maxByOrNull { it.getValue("query").jsonObject.size }
            ?: throw IllegalStateException("Unprepared source fixture request: $method $path")
        delay(route.getValue("delayMs").jsonPrimitive.long)
        val body = route.getValue("json").jsonObject
        check(route.getValue("status").jsonPrimitive.int == 200) { body.getValue("message").jsonPrimitive.content }
        return body
    }
    private suspend inline fun <reified T> value(method: String, path: String, query: Map<String, String> = emptyMap()): HttpData<T> {
        val response = response(method, path, query)
        return HttpData(json.decodeFromJsonElement<T>(response.getValue("data")), response.getValue("message").jsonPrimitive.content, response.getValue("code").jsonPrimitive.int)
    }
    override suspend fun rssLabs(): HttpData<RssLabs> = value("GET", "/v1/user/labs")
    override suspend fun rssEnable(enabled: Boolean): HttpData<JsonElement> = value("POST", "/v1/user/setting/" + if (enabled) "enable" else "disable")
    override suspend fun rssSubscriptions(): HttpData<RssSubscriptions> = value("GET", "/v1/rss/subscriptions")
    override suspend fun rssAdd(url: String, remark: String?): HttpData<RssSubscription> = value("POST", "/v1/rss/subscriptions")
    override suspend fun rssUpdate(id: String, remark: String?): HttpData<RssSubscription> = value("POST", "/v1/rss/subscriptions/$id/update")
    override suspend fun rssRemove(id: String): HttpData<JsonElement> = value("POST", "/v1/rss/subscriptions/$id/delete")
    override suspend fun rssRefresh(id: String): HttpData<RssRefresh> = value("POST", "/v1/rss/subscriptions/$id/refresh")
    override suspend fun rssEntries(subscription: String?, cursor: String?, fetchHistory: Boolean): HttpData<RssEntries> = value("GET", "/v1/rss/entries", buildMap {
        subscription?.let { put("subscription_id", it) }; cursor?.let { put("cursor", it) }; if (fetchHistory) put("fetch_history", "1")
    })
    override suspend fun rssDetail(id: String): HttpData<RssEntry> = value("GET", "/v1/rss/entries/$id")
    override suspend fun rssSave(id: String): HttpData<RssSave> = value("POST", "/v1/rss/entries/$id/save")
    override suspend fun sendFeedback(param: FeedbackParams): HttpData<String> = value("POST", "/v1/user/report")
    override suspend fun deleteAccount(): HttpData<DeleteAccountData> = value("POST", "/v1/user/delete_my_account")
}
