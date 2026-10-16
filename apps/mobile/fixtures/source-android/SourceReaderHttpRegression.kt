package com.slax.reader.fixtures

import com.slax.reader.data.network.ApiService
import com.slax.reader.data.network.dto.OverviewResponse
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*

/** Runs unchanged, compiled source ApiService classes with the controlled core engine. */
fun main() = runBlocking {
    val results = mutableListOf<JsonObject>()
    suspend fun checkCase(name: String, test: suspend () -> JsonObject) {
        results += withTimeout(4_000) {test()}.let {details -> buildJsonObject {
            put("name", name); put("passed", true); details.forEach {(key, value) -> put(key, value)}
        }}
    }
    fun payload(route: JsonObject) = buildJsonObject {
        put("network", buildJsonObject {put("isConnected", true)})
        put("api", buildJsonArray {add(route)})
    }
    fun route(path: String, status: Int = 200, body: JsonElement? = null, text: String? = null, chunks: JsonArray? = null) = buildJsonObject {
        put("method", "POST"); put("path", path); put("query", buildJsonObject {})
        put("status", status); put("delayMs", 0)
        body?.let {put("json", it)}; text?.let {put("text", it); put("contentType", "text/html")}
        chunks?.let {put("chunks", it); put("contentType", "text/event-stream")}
    }
    fun chunk(text: String, delayMs: Int = 0) = buildJsonObject {put("text", text); put("delayMs", delayMs)}
    val id = "00000003-0000-4000-8000-000000000001"
    checkCase("source-content-200-completes") {
        val fixture = FixtureReaderHttp(payload(route("/v1/bookmark/content", text = "<p>Exact synthetic article</p>")))
        try {
            check(ApiService(fixture.client).getBookmarkRawContent(id) == "<p>Exact synthetic article</p>")
            fixture.diagnostics()
        } finally {fixture.close()}
    }
    checkCase("source-content-503-valid-envelope-completes") {
        val fixture = FixtureReaderHttp(payload(route("/v1/bookmark/content", status = 503,
            body = buildJsonObject {put("code", 503); put("message", "source_unavailable"); put("data", "source_unavailable")})))
        try {
            val error = runCatching {ApiService(fixture.client).getBookmarkRawContent(id)}.exceptionOrNull()
            check(error?.javaClass?.simpleName == "HttpError" && error.message == "source_unavailable")
            fixture.diagnostics()
        } finally {fixture.close()}
    }
    checkCase("historical-malformed-envelope-retains-source-fallback") {
        val fixture = FixtureReaderHttp(payload(route("/v1/bookmark/content", status = 503,
            body = buildJsonObject {put("code", 503); put("message", "source_unavailable");
                put("data", buildJsonObject {put("error", "source_unavailable")})})))
        try {
            val error = runCatching {ApiService(fixture.client).getBookmarkRawContent(id)}.exceptionOrNull()
            check(error?.javaClass?.simpleName == "HttpError" && error.message == "Error: Service Unavailable")
            fixture.diagnostics()
        } finally {fixture.close()}
    }
    checkCase("source-overview-split-ndjson-stream-completes") {
        val chunks = buildJsonArray {
            add(chunk("{\"type\":\"overview\",\"data\":{\"overview\":\"First "))
            add(chunk("片段\"}}\n", 60))
            add(chunk("{\"type\":\"overview\",\"data\":{\"overview\":\"second\"}}\n", 60))
            add(chunk("{\"type\":\"key_takeaways\",\"data\":{\"key_takeaways\":[\"Exact takeaway\"]}}\n"))
            add(chunk("{\"type\":\"done\",\"data\":{\"done\":true}}"))
        }
        val fixture = FixtureReaderHttp(payload(route("/v1/bookmark/overview", chunks = chunks)))
        try {
            val events = ApiService(fixture.client).getBookmarkOverview(id).toList()
            check(events == listOf(OverviewResponse.Overview("First 片段"), OverviewResponse.Overview("second"),
                OverviewResponse.KeyTakeaways(listOf("Exact takeaway")), OverviewResponse.Done))
            check(fixture.diagnostics().getValue("streamsCompleted").jsonPrimitive.int == 1)
            fixture.diagnostics()
        } finally {fixture.close()}
    }
    val delayedChunks = buildJsonArray {
        add(chunk("{\"type\":\"overview\",\"data\":{\"overview\":\"first\"}}\n"))
        add(chunk("{\"type\":\"overview\",\"data\":{\"overview\":\"must be cancelled\"}}\n", 1500))
    }
    checkCase("source-overview-consumer-cancellation-stops-producer") {
        val fixture = FixtureReaderHttp(payload(route("/v1/bookmark/overview", chunks = delayedChunks)))
        try {
            val started = CompletableDeferred<Unit>()
            val events = mutableListOf<OverviewResponse>()
            val collector = launch {ApiService(fixture.client).getBookmarkOverview(id).collect {
                events += it; started.complete(Unit)
            }}
            started.await(); collector.cancelAndJoin()
            while (fixture.diagnostics().getValue("streamsCancelled").jsonPrimitive.int != 1) delay(10)
            delay(30)
            check(events == listOf(OverviewResponse.Overview("first")))
            check(fixture.diagnostics().getValue("streamChunksWritten").jsonPrimitive.int == 1)
            fixture.diagnostics()
        } finally {fixture.close()}
    }
    checkCase("fixture-close-stops-active-source-stream") {
        val fixture = FixtureReaderHttp(payload(route("/v1/bookmark/overview", chunks = delayedChunks)))
        try {
            val started = CompletableDeferred<Unit>()
            val events = mutableListOf<OverviewResponse>()
            val collector = launch {runCatching {ApiService(fixture.client).getBookmarkOverview(id).collect {
                events += it; started.complete(Unit)
            }}}
            started.await(); fixture.close(); collector.join()
            check(events == listOf(OverviewResponse.Overview("first")))
            check(fixture.diagnostics().getValue("streamsCancelled").jsonPrimitive.int == 1)
            check(fixture.diagnostics().getValue("streamChunksWritten").jsonPrimitive.int == 1)
            fixture.diagnostics()
        } finally {fixture.close()}
    }
    println(buildJsonObject {
        put("kind", "original-api-fixture-ktor-jvm-regression"); put("passed", true)
        put("sourceApiModified", false); put("networkSocketUsed", false); put("nativeUiVerified", false)
        put("cases", JsonArray(results))
    })
}
