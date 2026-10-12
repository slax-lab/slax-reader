package expo.modules.kotlin.modules

class AppContext { var reactContext: android.content.Context? = null }
open class Module {
  val appContext = AppContext()
  open fun definition(): ModuleDefinition = error("Not implemented")
}
class ModuleDefinition(build: ModuleDefinition.() -> Unit) {
  lateinit var imageCacheFileUri: (String, String, String) -> String?
  init { build() }
  fun Name(name: String) { check(name == "SlaxCachePaths") }
  fun Function(name: String, body: (String, String, String) -> String?) { check(name == "imageCacheFileUri"); imageCacheFileUri = body }
}
