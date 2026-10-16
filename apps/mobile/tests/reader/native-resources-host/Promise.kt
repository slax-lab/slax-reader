package expo.modules.kotlin
class Promise {
  @Volatile var value: Any? = null
  @Volatile var error: String? = null
  private val done = java.util.concurrent.CountDownLatch(1)
  fun resolve(value: Any?) { this.value = value; done.countDown() }
  fun reject(code: String, message: String, cause: Throwable?) { error = message; done.countDown() }
  fun await() {check(done.await(5, java.util.concurrent.TimeUnit.SECONDS)) {"Native image did not settle"}}
}
