package android.content

import java.io.File

class Context(val dataDir: File) {
  val cacheDir = File(dataDir, "cache")
  val filesDir = File(dataDir, "files")
  val resources = Resources()
  val applicationInfo = android.content.pm.ApplicationInfo()
}
class Resources { val displayMetrics = DisplayMetrics() }
class DisplayMetrics { val density = 1f }
