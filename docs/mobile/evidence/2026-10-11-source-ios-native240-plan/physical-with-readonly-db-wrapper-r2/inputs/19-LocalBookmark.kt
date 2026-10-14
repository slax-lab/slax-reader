package com.slax.reader.data.database.dao

import com.powersync.PowerSyncDatabase
import com.powersync.db.getString
import com.powersync.db.getStringOptional
import com.slax.reader.data.database.model.LocalBookmarkInfo
import com.slax.reader.data.database.model.mapperToLocalBookmarkInfo
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.Json

class LocalBookmarkDao(
    private val scope: CoroutineScope,
    private val database: PowerSyncDatabase
) : LocalBookmarkRepository {
    private val cacheOtherFields = listOf(
        "overview",
        "key_takeaways",
        "outline",
        "outline_read_position",
        "read_position",
        "mark_users",
    )

    private val _userLocalBookmarkListFlow: StateFlow<Map<String, LocalBookmarkInfo>> by lazy {
        println("[watch][database] _userLocalBookmarkListFlow")
        database.watch(
            """
            SELECT id,
                COALESCE(JSON_EXTRACT(data, '$.is_downloaded'), 0) as is_downloaded,
                JSON_EXTRACT(data, '$.is_auto_cached') as is_auto_cached
            FROM ps_data_local__local_bookmark_info
        """.trimIndent(),
            mapper = {
                mapperToLocalBookmarkInfo(it)
            }
        ).catch { e ->
            println("Error watching user bookmarks: ${e.message}")
        }
            .distinctUntilChanged()
            .map { bookmarkList ->
                bookmarkList.associateBy { it.id }
            }
            .stateIn(scope, SharingStarted.Eagerly, emptyMap())
    }

    override fun watchUserLocalBookmarkMap(): StateFlow<Map<String, LocalBookmarkInfo>> = _userLocalBookmarkListFlow

    private suspend fun upsertFields(
        bookmarkId: String,
        fields: Map<String, Any?>
    ) = withContext(Dispatchers.IO) {
        val d = "$"
        val jsonKeys = fields.keys.joinToString(", ") { "'$it', ?" }
        val jsonSetParts = fields.keys.joinToString(", ") {
            "'${d}.$it', json_extract(excluded.data, '${d}.$it')"
        }
        database.writeTransaction { tx ->
            tx.execute(
                """
                INSERT INTO ps_data_local__local_bookmark_info (id, data)
                VALUES (?, json_object($jsonKeys))
                ON CONFLICT(id) DO UPDATE SET
                data = json_set(data, $jsonSetParts);
            """.trimIndent(),
                parameters = listOf(bookmarkId) + fields.values.toList()
            )
        }
    }

    private suspend fun getField(
        bookmarkId: String,
        field: String
    ): String? {
        val d = "$"
        return database.getOptional(
            """
            SELECT json_extract(data, '${d}.$field') AS value
            FROM ps_data_local__local_bookmark_info
            WHERE id = ?
            """.trimIndent(),
            parameters = listOf(bookmarkId),
            mapper = { cursor ->
                cursor.getStringOptional("value")?.takeIf { it.isNotEmpty() } ?: ""
            }
        )?.takeIf { it.isNotEmpty() }
    }

    suspend fun updateLocalBookmarkDownloadStatus(
        bookmarkId: String,
        downloadStatus: Int,
        isAutoCached: Boolean
    ) = upsertFields(bookmarkId, mapOf("is_downloaded" to downloadStatus, "is_auto_cached" to if (isAutoCached) 1 else 0))

    /**
     * 自动下载不能把已被用户打开并固定的条目改回自动缓存。
     * 自动下载成功可以推进手动条目的完成状态；自动下载中/失败不能降级手动状态。
     */
    suspend fun updateAutoCachedDownloadStatus(bookmarkId: String, downloadStatus: Int) =
        withContext(Dispatchers.IO) {
            val d = "$"
            val updateData = if (downloadStatus == 2) {
                """
                json_set(
                    data,
                    '${d}.is_downloaded', 2,
                    '${d}.is_auto_cached',
                    CASE WHEN JSON_EXTRACT(data, '${d}.is_auto_cached') = 0 THEN 0 ELSE 1 END
                )
                """.trimIndent()
            } else {
                """
                CASE
                    WHEN JSON_EXTRACT(data, '${d}.is_auto_cached') = 0 THEN data
                    ELSE json_set(data, '${d}.is_downloaded', ?, '${d}.is_auto_cached', 1)
                END
                """.trimIndent()
            }
            val updateParameters = if (downloadStatus == 2) emptyList() else listOf(downloadStatus)

            database.writeTransaction { tx ->
                tx.execute(
                    """
                    INSERT INTO ps_data_local__local_bookmark_info (id, data)
                    VALUES (?, json_object('is_downloaded', ?, 'is_auto_cached', 1))
                    ON CONFLICT(id) DO UPDATE SET data = $updateData;
                    """.trimIndent(),
                    parameters = listOf(bookmarkId, downloadStatus) + updateParameters,
                )
            }
        }

    suspend fun isManuallyCached(bookmarkId: String): Boolean =
        getField(bookmarkId, "is_auto_cached") == "0"

    suspend fun batchResetDownloadStatus(
        bookmarkIds: List<String>,
        downloadStatus: Int = 0,
        isAutoCached: Boolean,
    ) = withContext(Dispatchers.IO) {
        if (bookmarkIds.isEmpty()) return@withContext
        database.writeTransaction { tx ->
            val d = "$"
            val jsonKeys = "'is_downloaded', ?, 'is_auto_cached', ?"
            val jsonSetParts = "'${d}.is_downloaded', json_extract(excluded.data, '${d}.is_downloaded'), '${d}.is_auto_cached', json_extract(excluded.data, '${d}.is_auto_cached')"
            bookmarkIds.forEach { bookmarkId ->
                tx.execute(
                    """
                    INSERT INTO ps_data_local__local_bookmark_info (id, data)
                    VALUES (?, json_object($jsonKeys))
                    ON CONFLICT(id) DO UPDATE SET
                    data = json_set(data, $jsonSetParts);
                """.trimIndent(),
                    parameters = listOf(bookmarkId, downloadStatus, if (isAutoCached) 1 else 0)
                )
            }
        }
    }

    suspend fun deleteLocalBookmarkInfo(bookmarkIds: List<String>) = withContext(Dispatchers.IO) {
        if (bookmarkIds.isEmpty()) return@withContext
        database.writeTransaction { tx ->
            bookmarkIds.forEach { bookmarkId ->
                tx.execute(
                    "DELETE FROM ps_data_local__local_bookmark_info WHERE id = ?",
                    parameters = listOf(bookmarkId),
                )
            }
        }
    }

    /**
     * 手动下载（用户点开文章触发）的条目 id。
     *
     * is_auto_cached 显式为 0 才算手动：字段缺失的旧数据在 mapper 里按 true 处理，
     * 这里保持一致，不把它们误判成手动条目。
     */
    suspend fun getManuallyCachedIds(): List<String> = withContext(Dispatchers.IO) {
        database.getAll(
            """
            SELECT id
            FROM ps_data_local__local_bookmark_info
            WHERE JSON_EXTRACT(data, '$.is_auto_cached') = 0
            """.trimIndent(),
            mapper = { it.getString("id") },
        )
    }

    suspend fun getCacheOtherBytes(): Long = withContext(Dispatchers.IO) {
        val d = "$"
        val byteExpression = cacheOtherFields.joinToString(" + ") { field ->
            "LENGTH(CAST(COALESCE(JSON_EXTRACT(data, '${d}.$field'), '') AS BLOB))"
        }
        database.getOptional(
            """
            SELECT COALESCE(SUM($byteExpression), 0) AS other_bytes
            FROM ps_data_local__local_bookmark_info
            """.trimIndent(),
            mapper = { cursor -> cursor.getStringOptional("other_bytes")?.toLongOrNull() ?: 0L },
        ) ?: 0L
    }

    suspend fun resetManualCacheArticleStatus(bookmarkIds: List<String>) = withContext(Dispatchers.IO) {
        if (bookmarkIds.isEmpty()) return@withContext
        val d = "$"
        database.writeTransaction { tx ->
            bookmarkIds.forEach { bookmarkId ->
                tx.execute(
                    """
                    UPDATE ps_data_local__local_bookmark_info
                    SET data = json_set(data, '${d}.is_downloaded', 0)
                    WHERE id = ? AND JSON_EXTRACT(data, '${d}.is_auto_cached') = 0
                    """.trimIndent(),
                    parameters = listOf(bookmarkId),
                )
            }
        }
    }

    suspend fun clearCacheOtherFields() = withContext(Dispatchers.IO) {
        val d = "$"
        val paths = cacheOtherFields.joinToString(",\n") { field -> "'${d}.$field'" }
        val hasCachedField = cacheOtherFields.joinToString(" OR ") { field ->
            "JSON_TYPE(data, '${d}.$field') IS NOT NULL"
        }
        database.writeTransaction { tx ->
            tx.execute(
                """
                UPDATE ps_data_local__local_bookmark_info
                SET data = json_remove(data, $paths)
                WHERE $hasCachedField
                """.trimIndent(),
            )
        }
    }

    suspend fun deleteEmptyManualCacheInfo(bookmarkIds: List<String>) = withContext(Dispatchers.IO) {
        if (bookmarkIds.isEmpty()) return@withContext
        val d = "$"
        val hasNoCachedFields = cacheOtherFields.joinToString(" AND ") { field ->
            "JSON_TYPE(data, '${d}.$field') IS NULL"
        }
        database.writeTransaction { tx ->
            bookmarkIds.forEach { bookmarkId ->
                tx.execute(
                    """
                    DELETE FROM ps_data_local__local_bookmark_info
                    WHERE id = ?
                        AND JSON_EXTRACT(data, '${d}.is_auto_cached') = 0
                        AND COALESCE(JSON_EXTRACT(data, '${d}.is_downloaded'), 0) = 0
                        AND $hasNoCachedFields
                    """.trimIndent(),
                    parameters = listOf(bookmarkId),
                )
            }
        }
    }

    override suspend fun updateLocalBookmarkOverview(
        bookmarkId: String,
        overview: String,
        keyTakeaways: String?
    ) = upsertFields(bookmarkId, mapOf("overview" to overview, "key_takeaways" to keyTakeaways))

    override suspend fun getLocalBookmarkOverview(bookmarkId: String): Pair<String?, List<String>?> {
        val d = "$"
        val result = database.getOptional(
            """
            SELECT
                json_extract(data, '${d}.overview') AS overview,
                json_extract(data, '${d}.key_takeaways') AS key_takeaways
            FROM ps_data_local__local_bookmark_info
            WHERE id = ?
            """.trimIndent(),
            parameters = listOf(bookmarkId),
            mapper = { cursor ->
                val overview = cursor.getStringOptional("overview").let { if (it.isNullOrEmpty()) null else it }
                val keyTakeaways = cursor.getStringOptional("key_takeaways").let {
                    if (it.isNullOrEmpty()) {
                        null
                    } else {
                        try {
                            Json.decodeFromString<List<String>>(it)
                        } catch (e: Exception) {
                            println("Failed to deserialize keyTakeaways: ${e.message}")
                            null
                        }
                    }
                }
                Pair(overview, keyTakeaways)
            }
        ) ?: Pair(null, null)
        return result
    }

    suspend fun updateLocalBookmarkReadPosition(
        bookmarkId: String,
        readPosition: Float
    ) = upsertFields(bookmarkId, mapOf("read_position" to readPosition.toString()))

    suspend fun getLocalBookmarkReadPosition(bookmarkId: String): Float? =
        getField(bookmarkId, "read_position")?.toFloatOrNull()

    override suspend fun updateLocalBookmarkOutline(
        bookmarkId: String,
        outline: String,
    ) = upsertFields(bookmarkId, mapOf("outline" to outline))

    override suspend fun getLocalBookmarkOutline(bookmarkId: String): String? =
        getField(bookmarkId, "outline")

    override suspend fun updateLocalBookmarkOutlineScrollPosition(
        bookmarkId: String,
        scrollPosition: Int
    ) = upsertFields(bookmarkId, mapOf("outline_read_position" to scrollPosition.toString()))

    override suspend fun getLocalBookmarkOutlineScrollPosition(bookmarkId: String): Int? =
        getField(bookmarkId, "outline_read_position")?.toIntOrNull()

    suspend fun updateMarkUsers(bookmarkId: String, markUsersJson: String) =
        upsertFields(bookmarkId, mapOf("mark_users" to markUsersJson))

    suspend fun getMarkUsers(bookmarkId: String): String? =
        getField(bookmarkId, "mark_users")
}
