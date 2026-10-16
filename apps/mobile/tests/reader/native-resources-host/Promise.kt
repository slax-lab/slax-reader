package expo.modules.kotlin
class Promise {
  @Volatile var value: Any? = null
  @Volatile var error: String? = null
  fun resolve(value: Any?) { this.value = value }
  fun reject(code: String, message: String, cause: Throwable?) { error = message }
}
