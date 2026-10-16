package expo.modules.kotlin.modules

import expo.modules.kotlin.Promise
class AppContext { var reactContext: android.content.Context? = null }
open class Module { val appContext = AppContext(); open fun definition(): ModuleDefinition = error("Not implemented") }
class ModuleDefinition(build: ModuleDefinition.() -> Unit) {
  val functions = mutableMapOf<String, (Array<Any?>) -> Unit>()
  val synchronous = mutableMapOf<String, (Array<Any?>) -> Any?>()
  @Suppress("UNCHECKED_CAST")
  fun <A, R> Function(name: String, work: (A) -> R) {synchronous[name] = {work(it[0] as A)}}
  @Suppress("UNCHECKED_CAST")
  fun <A, B, R> Function(name: String, work: (A, B) -> R) {synchronous[name] = {work(it[0] as A, it[1] as B)}}
  init {build()}
  fun Name(name: String) {check(name in listOf("SlaxStorage", "SlaxPdfTransfer", "SlaxImageCache"))}
  @Suppress("UNCHECKED_CAST")
  fun <A, B, C> AsyncFunction(name: String, work: (A, B, C) -> Unit) {functions[name] = { work(it[0] as A, it[1] as B, it[2] as C) }}
  @Suppress("UNCHECKED_CAST")
  fun <A, B, C, D> AsyncFunction(name: String, work: (A, B, C, D) -> Unit) {functions[name] = { work(it[0] as A, it[1] as B, it[2] as C, it[3] as D) }}
  @Suppress("UNCHECKED_CAST")
  fun <A, B, C, D, E> AsyncFunction(name: String, work: (A, B, C, D, E) -> Unit) {functions[name] = { work(it[0] as A, it[1] as B, it[2] as C, it[3] as D, it[4] as E) }}
  @Suppress("UNCHECKED_CAST")
  fun <A, B, C, D, E, F> AsyncFunction(name: String, work: (A, B, C, D, E, F) -> Unit) {functions[name] = { work(it[0] as A, it[1] as B, it[2] as C, it[3] as D, it[4] as E, it[5] as F) }}
}
