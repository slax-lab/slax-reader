package com.slax.reader.fixtures

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngineBase
import io.ktor.client.engine.HttpClientEngineConfig
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
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

/** The existing Ktor core parses source API/SSE responses without an HTTP socket engine. */
class FixtureReaderHttp(payload: JsonObject) {
    private val engine = FixtureReaderEngine(payload)
    val client = HttpClient(engine) {
        install(ContentNegotiation) { json(Json {ignoreUnknownKeys = true; encodeDefaults = true}) }
    }
    fun close() {client.close(); engine.close()}
}

@OptIn(InternalAPI::class)
private class FixtureReaderEngine(private val payload: JsonObject) : HttpClientEngineBase("source-reader-fixture") {
    override val config = HttpClientEngineConfig()
    override suspend fun execute(data: HttpRequestData): HttpResponseData {
        check(data.url.protocol == URLProtocol.HTTPS && data.url.port == 443 &&
            data.url.user == null && data.url.password == null &&
            data.url.host in setOf("fixture-api.test", "fixture-api-beta.test")) {
            "Source reader fixture rejected an unprepared origin"
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
        delay(route.getValue("delayMs").jsonPrimitive.long)
        val body: ByteReadChannel = if (route["chunks"] != null) {
            val channel = ByteChannel(autoFlush = true)
            // Bind the producer to the real Ktor request job as well as the
            // fixture engine lifetime, so navigation/close cancels its stream.
            val producer = launch(data.executionContext) {
                try {
                    route.getValue("chunks").jsonArray.forEach {raw ->
                        val chunk = raw.jsonObject
                        delay(chunk.getValue("delayMs").jsonPrimitive.long)
                        channel.writeStringUtf8(chunk.getValue("text").jsonPrimitive.content)
                    }
                    channel.flushAndClose()
                } catch (error: Throwable) {channel.cancel(error)}
            }
            coroutineContext[kotlinx.coroutines.Job]?.invokeOnCompletion {producer.cancel()}
            channel
        } else ByteReadChannel((route["text"]?.jsonPrimitive?.content ?: route.getValue("json").toString()).encodeToByteArray())
        return HttpResponseData(
            statusCode = HttpStatusCode.fromValue(route.getValue("status").jsonPrimitive.int),
            requestTime = GMTDate(),
            headers = headersOf(HttpHeaders.ContentType, route["contentType"]?.jsonPrimitive?.content ?: "application/json"),
            version = HttpProtocolVersion.HTTP_1_1, body = body,
            callContext = coroutineContext + data.executionContext,
        )
    }
}
