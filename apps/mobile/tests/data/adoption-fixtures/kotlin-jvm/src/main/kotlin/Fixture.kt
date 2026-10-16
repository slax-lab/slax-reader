import com.powersync.DatabaseDriverFactory
import com.powersync.PowerSyncDatabase
import com.slax.reader.data.database.AppSchema
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.*
import java.io.File

// Fixture values are synthetic; this executable never opens a production database.
fun main(args: Array<String>) = runBlocking {
    val directory = File(args.single()).canonicalFile
    require(directory.name == "generated" && directory.parentFile.name == "kotlin-jvm")
    directory.mkdirs()
    val path = File(directory, "powersync.db")
    require(!path.exists()) { "Fixture already exists; use an isolated fresh directory" }
    writeLegacyPreferenceFixture(directory)
    val db = PowerSyncDatabase(DatabaseDriverFactory(), AppSchema, dbFilename = "powersync.db", dbDirectory = directory.path)
    try {
        db.writeTransaction { tx ->
            tx.execute("INSERT INTO sr_user_tag(id,user_id,tag_name,display) VALUES(?,?,?,?)", listOf("tag-1", "synthetic-user", "offline", "Offline"))
            tx.execute("INSERT INTO sr_user_bookmark(id,user_id,alias_title,metadata,is_starred) VALUES(?,?,?,?,?)", listOf("bookmark-1", "synthetic-user", "Offline article", "{\"tags\":[\"tag-1\"],\"share\":{\"allow_access\":1}}", 0))
        }
        db.writeTransaction { tx ->
            tx.execute("UPDATE sr_user_bookmark SET is_starred=1, metadata=? WHERE id=?", listOf("{\"tags\":[\"tag-1\",\"tag-2\"],\"share\":{\"allow_access\":0}}", "bookmark-1"))
            tx.execute("INSERT INTO sr_bookmark_comment(id,source,comment,metadata) VALUES(?,?,?,?)", listOf("comment-1", "{\"start_offset\":3,\"end_offset\":12}", "Pending comment", "{\"thread\":\"thread-1\"}"))
        }
        // The source app stores undeclared cache/position fields in this local-only JSON row.
        db.execute("INSERT INTO ps_data_local__local_bookmark_info(id,data) VALUES(?,?)", listOf("bookmark-1", "{\"overview\":\"Offline summary\",\"is_downloaded\":1,\"read_position\":\"348.25\",\"outline_read_position\":\"12\",\"is_auto_cached\":0,\"future_field\":{\"preserve\":true}}"))
        val transactions = db.getCrudTransactions().toList()
        check(transactions.map { it.crud.size } == listOf(2, 2))
        val output = buildJsonObject {
            put("producer", "powersync-kotlin-1.14.1")
            put("coreVersion", db.getPowerSyncVersion())
            putJsonArray("transactions") { transactions.forEach { transaction -> add(buildJsonObject {
                put("transactionId", JsonPrimitive(transaction.transactionId))
                putJsonArray("crud") { transaction.crud.forEach { entry -> add(buildJsonObject {
                    put("clientId", entry.clientId); put("id", entry.id); put("op", entry.op.toString()); put("table", entry.table)
                    put("opData", entry.opData?.let { JsonObject(it.mapValues { (_, value) -> value?.let(::JsonPrimitive) ?: JsonNull }) } ?: JsonNull)
                    put("previousValues", entry.previousValues?.let { JsonObject(it.mapValues { (_, value) -> value?.let(::JsonPrimitive) ?: JsonNull }) } ?: JsonNull)
                }) } }
            }) } }
            put("localJson", db.get("SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?", listOf("bookmark-1")) { it.getString(0)!! })
        }
        File(directory, "old-sdk-report.json").writeText(Json { prettyPrint = true }.encodeToString(JsonObject.serializer(), output))
        println("Created synthetic Kotlin 1.14.1 fixture: ${transactions.size} transactions / ${transactions.sumOf { it.crud.size }} pending operations")
    } finally { db.close() }
}
