package com.slax.reader.platform

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import org.json.JSONObject

class SlaxCachePathsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SlaxCachePaths")
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
