package expo.modules.kotlin

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
class Promise {
  var value: Any? = null
  var error: String? = null
  var thread: String? = null
  private val done = CountDownLatch(1)
  fun resolve(result: Any?) {value = result; thread = Thread.currentThread().name; done.countDown()}
  fun reject(code: String, message: String, cause: Throwable?) {error = message; thread = Thread.currentThread().name; done.countDown()}
  fun await() {check(done.await(5, TimeUnit.SECONDS)) {"Native storage operation did not settle"}}
}
