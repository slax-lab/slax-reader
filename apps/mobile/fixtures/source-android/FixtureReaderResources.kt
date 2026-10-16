package com.slax.reader.fixtures

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger

/** Local responses for declared synthetic images; this fixture never opens the network. */
object FixtureReaderResources {
    private val declaredUrls = setOf(
        "https://fixture-images.test/success.png",
        "https://fixture-images.test/failure.png",
        "https://fixture-images.test/rss.png?m=rss&d=fixture-only",
    )
    private data class Image(val file: File, val sha256: String)
    @Volatile private var prepared: Map<String, Image> = emptyMap()
    private val requests = AtomicInteger()
    val requestCount: Int get() = requests.get()

    fun prepare(root: File, cacheKey: String, urls: List<String>, artwork: ByteArray) {
        check(cacheKey.matches(Regex("[A-Za-z0-9_-]+")))
        check(urls.toSet() == declaredUrls && urls.size == declaredUrls.size)
        val canonicalRoot = root.canonicalFile
        val directory = File(canonicalRoot, "bookmark/$cacheKey/images").canonicalFile
        check(directory.path.startsWith(canonicalRoot.path + File.separator))
        check(directory.isDirectory || directory.mkdirs())
        val expected = digest("SHA-256", artwork)
        prepared = urls.filterNot {it.endsWith("/failure.png")}.associateWith {url ->
            val uri = URI(url)
            check(uri.scheme == "https" && uri.host == "fixture-images.test" && uri.port == -1 && uri.userInfo == null && uri.fragment == null)
            val name = digest("MD5", url.toByteArray(Charsets.UTF_8)) + ".png"
            val file = File(directory, name).canonicalFile
            check(file.parentFile == directory)
            file.writeBytes(artwork)
            check(digest("SHA-256", file.readBytes()) == expected)
            Image(file, expected)
        }
        requests.set(0)
    }

    fun intercept(request: WebResourceRequest?): WebResourceResponse? {
        val url = request?.url?.toString() ?: return null
        val scheme = runCatching {URI(url).scheme?.lowercase()}.getOrNull()
        if (scheme != "http" && scheme != "https") return null
        requests.incrementAndGet()
        val image = if (request?.method == "GET") prepared[url] else null
        val bytes = image?.let {runCatching {check(it.file.canonicalFile == it.file); it.file.readBytes()}.getOrNull()}
        if (image != null && bytes != null && digest("SHA-256", bytes) == image.sha256) {
            return WebResourceResponse("image/png", null, 200, "OK", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(bytes))
        }
        return WebResourceResponse("text/plain", "utf-8", 404, "Fixture resource unavailable", emptyMap(), ByteArrayInputStream(byteArrayOf()))
    }

    private fun digest(algorithm: String, bytes: ByteArray) = MessageDigest.getInstance(algorithm).digest(bytes)
        .joinToString("") {"%02x".format(it.toInt() and 255)}
}
