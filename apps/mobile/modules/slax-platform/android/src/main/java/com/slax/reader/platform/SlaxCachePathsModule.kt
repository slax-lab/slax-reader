package com.slax.reader.platform

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import org.json.JSONObject

class SlaxCachePathsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SlaxCachePaths")
    Function("pdfCacheFileUri") { directory: String, relativePath: String ->
      val context = appContext.reactContext ?: error("Application context unavailable")
      runCatching {
        val uri = android.net.Uri.parse(if (directory.startsWith("file://")) directory else File(directory).toURI().toString())
        if (uri.scheme != "file") return@runCatching null
        val root = File(uri.path ?: return@runCatching null).canonicalFile
        if (root != context.dataDir.canonicalFile) return@runCatching null
        val parts = relativePath.split('/')
        if (parts.firstOrNull() != "pdf" || parts.any { it == "." || it == ".." || !Regex("^[A-Za-z0-9_.-]+$").matches(it) }) return@runCatching null
        val files = File(root, "files")
        if (files.canonicalFile != files || context.filesDir.canonicalFile != files || java.nio.file.Files.isSymbolicLink(files.toPath())) return@runCatching null
        var current = files
        for (part in parts) {
          current = File(current, part)
          if (current.canonicalFile != current.absoluteFile || java.nio.file.Files.isSymbolicLink(current.toPath())) return@runCatching null
        }
        android.net.Uri.fromFile(current).toString()
      }.getOrNull()
    }
    Function("imageCacheFileUri") { directory: String, key: String, relativePath: String ->
      val context = appContext.reactContext ?: error("Application context unavailable")
      val root = File(android.net.Uri.parse(if (directory.startsWith("file://")) directory else File(directory).toURI().toString()).path ?: return@Function null).canonicalFile
      val prefix = "bookmark/$key/images/"
      val fixture = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0 &&
        root.path.startsWith(File(context.cacheDir, "slax-ui-fixtures").canonicalPath + File.separator) && runCatching {
          val marker = JSONObject(File(root, "slax-fixture.json").readText())
          marker.optBoolean("controlledFixture") && marker.optInt("fixtureVersion") == 1
        }.getOrDefault(false)
      if ((root != context.dataDir.canonicalFile && !fixture) || !relativePath.startsWith(prefix)) null
      else SlaxCachePaths.file(root, key, relativePath.removePrefix(prefix))?.let { android.net.Uri.fromFile(it).toString() }
    }
  }
}
