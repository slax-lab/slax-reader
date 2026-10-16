import androidx.datastore.preferences.core.*
import com.powersync.DatabaseDriverFactory
import com.powersync.PowerSyncDatabase
import com.slax.reader.data.database.AppSchema
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.*
import okio.FileSystem
import okio.Path.Companion.toPath

/** Only the isolated simulator app calls this producer with its synthetic sandbox paths. */
class LegacyFixtureProducer {
    suspend fun createFixture(sharedDirectory: String, cacheDirectory: String): String {
        val preferencesPath = "$sharedDirectory/user.preferences_pb".toPath()
        check(!FileSystem.SYSTEM.exists(preferencesPath)) { "Controlled preferences must be fresh" }
        val preferencesScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val preferences = PreferenceDataStoreFactory.createWithPath(scope = preferencesScope, produceFile = {preferencesPath})
        try {
            preferences.edit { values ->
                values[stringPreferencesKey("auth_token")] = "fixture-auth-token-NOT-A-REAL-CREDENTIAL"
                values[stringPreferencesKey("user_id")] = "synthetic-user"
                values[stringPreferencesKey("last_refresh_time")] = "1700000000"
                values[longPreferencesKey("powersync_refresh_time")] = 1700000000123L
                values[stringPreferencesKey("powersync_token")] = "fixture-sync-token-NOT-A-REAL-CREDENTIAL"
                values[stringPreferencesKey("powersync_connect_url")] = "https://sync.invalid/controlled-fixture"
                values[stringPreferencesKey("continue_reading_bookmark")] = "{\"bookmarkId\":\"bookmark-1\",\"title\":\"Offline article\",\"collectionOwnerId\":\"synthetic-owner\",\"collectionId\":\"synthetic-collection\"}"
                values[stringPreferencesKey("user_setting_detail_do_not_alert")] = "1"
                values[stringPreferencesKey("user_language")] = "zh-CN"
                values[intPreferencesKey("cache_count")] = -1
                values[intPreferencesKey("download_images")] = 1
                values[stringPreferencesKey("selected_env")] = "BETA"
                values[stringPreferencesKey("analytics_device_id")] = "fixture-stable-device-id"
                values[booleanPreferencesKey("future_boolean")] = true
                values[stringSetPreferencesKey("future_strings")] = setOf("one", "two")
            }
        } finally { preferencesScope.cancel() }
        // The source iOS DI supplies the filename and leaves the Apple SDK directory default intact.
        val db = PowerSyncDatabase(DatabaseDriverFactory(), AppSchema, dbFilename = "powersync.db")
        val report = try {
            db.writeTransaction { tx ->
                tx.execute("INSERT INTO sr_user_tag(id,user_id,tag_name,display) VALUES(?,?,?,?)", listOf("tag-1", "synthetic-user", "offline", "Offline"))
                tx.execute("INSERT INTO sr_user_bookmark(id,user_id,alias_title,metadata,is_starred) VALUES(?,?,?,?,?)", listOf("bookmark-1", "synthetic-user", "Offline article", "{\"tags\":[\"tag-1\"],\"share\":{\"allow_access\":1}}", 0))
            }
            db.writeTransaction { tx ->
                tx.execute("UPDATE sr_user_bookmark SET is_starred=1,metadata=? WHERE id=?", listOf("{\"tags\":[\"tag-1\",\"tag-2\"],\"share\":{\"allow_access\":0}}", "bookmark-1"))
                tx.execute("INSERT INTO sr_bookmark_comment(id,source,comment,metadata) VALUES(?,?,?,?)", listOf("comment-1", "{\"start_offset\":3,\"end_offset\":12}", "Pending comment", "{\"thread\":\"thread-1\"}"))
            }
            val localJson = "{\"overview\":\"Offline summary\",\"is_downloaded\":1,\"read_position\":\"348.25\",\"outline_read_position\":\"12\",\"is_auto_cached\":0,\"future_field\":{\"preserve\":true}}"
            db.execute("INSERT INTO ps_data_local__local_bookmark_info(id,data) VALUES(?,?)", listOf("bookmark-1", localJson))
            val transactions = db.getCrudTransactions().toList()
            check(transactions.map {it.crud.size} == listOf(2, 2))
            val article = "$cacheDirectory/bookmark/bookmark-1/content.html".toPath()
            FileSystem.SYSTEM.createDirectories(article.parent!!)
            FileSystem.SYSTEM.write(article) {writeUtf8("<article><p>Controlled offline fixture</p></article>")}
            buildJsonObject {
                put("controlledFixture", true); put("fixtureVersion", 1); put("iosBundleId", "app.slax.reader")
                put("producer", "powersync-kotlin-1.14.1"); put("coreVersion", db.getPowerSyncVersion())
                putJsonArray("transactions") {transactions.forEach {transaction -> add(buildJsonObject {
                    put("transactionId", JsonPrimitive(transaction.transactionId))
                    putJsonArray("crud") {transaction.crud.forEach {entry -> add(buildJsonObject {
                        put("clientId", entry.clientId); put("id", entry.id); put("op", entry.op.toString()); put("table", entry.table)
                        put("opData", entry.opData?.jsonValues ?: JsonNull); put("previousValues", entry.previousValues?.jsonValues ?: JsonNull)
                    })}}
                })}}
                put("localJson", db.get("SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?", listOf("bookmark-1")) {it.getString(0)!!})
            }
        } finally {db.close()}
        return Json {prettyPrint = true}.encodeToString(JsonObject.serializer(), report)
    }
}
