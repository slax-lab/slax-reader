package com.slax.reader.fixtures

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngineBase
import io.ktor.client.engine.HttpClientEngineConfig
import io.ktor.client.engine.callContext
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.*
import io.ktor.http.content.OutgoingContent
import io.ktor.serialization.kotlinx.json.json
import io.ktor.utils.io.InternalAPI
import io.ktor.util.date.GMTDate
import io.ktor.utils.io.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.cancel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.*

/** The existing Ktor core parses source API/SSE responses without an HTTP socket engine. */
class FixtureReaderHttp(payload: JsonObject) {
    private val engine = FixtureReaderEngine(payload)
    val client = HttpClient(engine) {
        install(ContentNegotiation) { json(Json {ignoreUnknownKeys = true; encodeDefaults = true}) }
    }
    fun diagnostics(): JsonObject = engine.diagnostics()
    fun close() {client.close(); engine.close()}
}

@OptIn(InternalAPI::class)
private class FixtureReaderEngine(private val payload: JsonObject) : HttpClientEngineBase("source-reader-fixture") {
    override val config = HttpClientEngineConfig()
    override fun close() {
        super.close()
        // HttpClient's ordinary close permits active calls to finish. This
        // separate controlled fixture is disposed with its screen instead.
        coroutineContext.cancel()
    }
    private data class Diagnostic(
        val acceptedRequests: Int = 0, val responseCount: Int = 0, val lastPath: String = "", val lastMethod: String = "",
        val lastStage: String = "not-requested", val lastStatus: Int? = null, val streamChunksWritten: Int = 0,
        val streamsCompleted: Int = 0, val streamsCancelled: Int = 0,
    )
    // StateFlow's immutable atomic updates work in both controlled JVM and
    // Kotlin/Native builds, without platform-specific synchronization shims.
    private val diagnostic = MutableStateFlow(Diagnostic())
    private fun stage(value: String) {diagnostic.update {it.copy(lastStage = value)}}
    fun diagnostics(): JsonObject {
        val state = diagnostic.value
        return buildJsonObject {
            put("acceptedRequests", state.acceptedRequests); put("responsesCreated", state.responseCount)
            put("lastMethod", state.lastMethod); put("lastPath", state.lastPath); put("lastStage", state.lastStage)
            put("lastStatus", state.lastStatus?.let {JsonPrimitive(it)} ?: JsonNull)
            put("streamChunksWritten", state.streamChunksWritten); put("streamsCompleted", state.streamsCompleted)
            put("streamsCancelled", state.streamsCancelled)
        }
    }
    override suspend fun execute(data: HttpRequestData): HttpResponseData {
        // Ktor owns a distinct response call lifetime. Reusing the request
        // execution job makes response-body completion wait on its own caller.
        val responseContext = callContext()
        check(data.url.protocol == URLProtocol.HTTPS && data.url.port == 443 &&
            data.url.user == null && data.url.password == null &&
            data.url.host in setOf("fixture-api.test", "fixture-api-beta.test")) {
            "Source reader fixture rejected an unprepared origin"
        }
        // Record only prepared route identity and stages. No body, query values,
        // headers, credentials, or article contents enter rejection diagnostics.
        diagnostic.update {
            it.copy(acceptedRequests = it.acceptedRequests + 1, lastMethod = data.method.value, lastPath = data.url.encodedPath,
                lastStage = "origin-accepted", lastStatus = null)
        }
        check(payload.getValue("network").jsonObject.getValue("isConnected").jsonPrimitive.boolean) {"No network connection"}
        val requestBody = (data.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString()?.let {
            runCatching {Json.parseToJsonElement(it)}.getOrNull()
        }
        val route = payload.getValue("api").jsonArray.map {it.jsonObject}.filter {candidate ->
            candidate.getValue("method").jsonPrimitive.content == data.method.value &&
                candidate.getValue("path").jsonPrimitive.content == data.url.encodedPath &&
                candidate.getValue("query").jsonObject.all {(key, value) -> data.url.parameters[key] == value.jsonPrimitive.content} &&
                (candidate["requestBody"]?.jsonObject?.all {(key, value) -> (requestBody as? JsonObject)?.get(key) == value} ?: true)
        }.maxByOrNull {it.getValue("query").jsonObject.size + (it["requestBody"]?.jsonObject?.size ?: 0)}
            ?: error("Source reader fixture rejected an unprepared route")
        diagnostic.update {it.copy(lastStage = "route-matched", lastStatus = route.getValue("status").jsonPrimitive.int)}
        delay(route.getValue("delayMs").jsonPrimitive.long)
        stage("delay-completed")
        val body: ByteReadChannel = if (route["chunks"] != null) {
            val channel = ByteChannel(autoFlush = true)
            // The call context is also an engine child. Consumer cancellation
            // and fixture shutdown therefore cancel delayed chunks together.
            CoroutineScope(responseContext).launch {
                try {
                    route.getValue("chunks").jsonArray.forEach {raw ->
                        val chunk = raw.jsonObject
                        delay(chunk.getValue("delayMs").jsonPrimitive.long)
                        channel.writeStringUtf8(chunk.getValue("text").jsonPrimitive.content)
                        diagnostic.update {it.copy(streamChunksWritten = it.streamChunksWritten + 1)}
                    }
                    channel.flushAndClose()
                    diagnostic.update {it.copy(streamsCompleted = it.streamsCompleted + 1)}
                } catch (error: Throwable) {
                    diagnostic.update {it.copy(streamsCancelled = it.streamsCancelled + 1)}
                    channel.cancel(error)
                }
            }
            channel
        } else ByteReadChannel((route["text"]?.jsonPrimitive?.content ?: route.getValue("json").toString()).encodeToByteArray())
        val response = HttpResponseData(
            statusCode = HttpStatusCode.fromValue(route.getValue("status").jsonPrimitive.int),
            requestTime = GMTDate(),
            headers = headersOf(HttpHeaders.ContentType, route["contentType"]?.jsonPrimitive?.content ?: "application/json"),
            version = HttpProtocolVersion.HTTP_1_1, body = body,
            callContext = responseContext,
        )
        diagnostic.update {it.copy(responseCount = it.responseCount + 1, lastStage = "response-created")}
        return response
    }
}
