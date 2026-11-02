package com.slax.reader.legacy

import java.io.File

internal fun resolveDatabaseDirectory(root: File, filesDirectory: File): File {
  val files = File(root.canonicalFile, "files")
  val directory = File(files, "slax-react-native")
  check(files.canonicalFile == files && filesDirectory.canonicalFile == files && directory.canonicalFile == directory) { "Database directory requires recovery" }
  return directory
}
