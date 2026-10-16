package expo.modules.kotlin.modules

class AppContext { var reactContext: android.content.Context? = null }
open class Module {
  val appContext = AppContext()
  open fun definition(): ModuleDefinition = error("Not implemented")
}
class ModuleDefinition(build: ModuleDefinition.() -> Unit) {
  lateinit var imageCacheFileUri: (String, String, String) -> String?
  lateinit var pdfCacheFileUri: (String, String) -> String?
  val synchronous = mutableMapOf<String, (Array<Any?>) -> Any?>()
  val functions = mutableMapOf<String, (Array<Any?>) -> Unit>()
  init { build() }
  fun Name(name: String) { check(name in listOf("SlaxCachePaths", "SlaxImageCache")) }
  @Suppress("UNCHECKED_CAST")
  fun <A, R> Function(name: String, body: (A) -> R) {synchronous[name] = {body(it[0] as A)}}
  @Suppress("UNCHECKED_CAST")
  fun <A, B, R> Function(name: String, body: (A, B) -> R) {
    if (name == "pdfCacheFileUri") pdfCacheFileUri = body as (String, String) -> String?
    synchronous[name] = {body(it[0] as A, it[1] as B)}
  }
  @Suppress("UNCHECKED_CAST")
  fun <A, B, C, R> Function(name: String, body: (A, B, C) -> R) { if (name == "imageCacheFileUri") imageCacheFileUri = body as (String, String, String) -> String? }
  @Suppress("UNCHECKED_CAST")
  fun <A, B, C, D> AsyncFunction(name: String, body: (A, B, C, D) -> Unit) {functions[name] = {body(it[0] as A, it[1] as B, it[2] as C, it[3] as D)}}
}
