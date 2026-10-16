import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.okio.OkioStorage
import androidx.datastore.preferences.core.*
import kotlinx.coroutines.*
import okio.FileSystem
import okio.Path.Companion.toPath
import java.io.File

// Uses the original serializer with fixed synthetic values; no application preferences are read.
suspend fun writeLegacyPreferenceFixture(directory: File) {
    val preferencesFile = File(directory, "user.preferences_pb")
    check(!preferencesFile.exists()) { "Synthetic preferences must be fresh" }
    val preferencesScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val preferences = DataStoreFactory.create(storage = OkioStorage(fileSystem = FileSystem.SYSTEM, serializer = PreferencesSerializer) { preferencesFile.absolutePath.toPath() }, scope = preferencesScope)
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
}
