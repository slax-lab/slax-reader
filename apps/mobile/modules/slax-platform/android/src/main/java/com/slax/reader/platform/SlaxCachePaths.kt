package com.slax.reader.platform

import java.io.File

internal object SlaxCachePaths {
  fun file(root: File, key: String, name: String): File? = runCatching {
    if (!Regex("^[A-Za-z0-9_-]+$").matches(key) || !Regex("^[a-f0-9]{32}\\..+$").matches(name) || name.length > 64 || name.any { it == '\\' || it.code < 32 || it.code == 127 }) return null
    val parts = name.split('/')
    if (parts.any { it.isEmpty() || it == "." || it == ".." }) return null
    var current = root.canonicalFile
    for (part in listOf("bookmark", key, "images") + parts) {
      current = File(current, part)
      if (current.canonicalFile != current.absoluteFile || java.nio.file.Files.isSymbolicLink(current.toPath())) return null
    }
    current
  }.getOrNull()
}
