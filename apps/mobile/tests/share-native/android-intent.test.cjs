const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, readFileSync, writeFileSync, rmSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {tmpdir} = require('node:os');
const path = require('node:path');

const source = readFileSync(path.resolve(__dirname, '../../modules/slax-share/android/src/main/java/com/slax/reader/extension/ShareActivity.kt'), 'utf8');
function method(signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `Missing production method: ${signature}`);
  const body = source.indexOf('{', start);
  let depth = 1, end = body + 1;
  for (; depth && end < source.length; end++) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
  }
  assert.equal(depth, 0);
  return source.slice(start, end);
}

test('production Android share completion closes without animation and preserves replacement ownership', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-intent-'));
  try {
    const schedule = source.match(/if \(success\) main\.postDelayed\(closeSuccessfulShare, (\d+)\)/);
    assert.ok(schedule, 'Success must schedule direct finish, not an animation end callback');
    const host = `
import java.util.concurrent.Executors
class Intent(val action: String, val type: String, val extras: MutableMap<String, String>, var flags: Int) {
  var target: Class<*>? = null
  constructor(other: Intent): this(other.action, other.type, other.extras.toMutableMap(), other.flags) {target = other.target}
  fun setClass(context: Any, target: Class<*>) = apply {this.target = target}
}
open class Activity {
  val events = mutableListOf<String>()
  var isFinishing = false
  var isDestroyed = false
  var finishes = 0
  val dispatched = mutableListOf<Intent>()
  open fun onResume() {}
  open fun onPause() {}
  open fun onDestroy() {isDestroyed = true}
  open fun onNewIntent(intent: Intent) {events.add("super")}
  fun finish() {isFinishing = true; finishes++; events.add("finish")}
  fun startActivity(intent: Intent) {check(isFinishing); events.add("start"); dispatched.add(intent)}
}
class Handler(val events: MutableList<String>) {
  val pending = mutableListOf<() -> Unit>()
  val delayed = mutableListOf<Runnable>()
  fun post(action: () -> Unit) {pending.add(action)}
  fun postDelayed(action: Runnable, delay: Long) {check(delay == 2000L); delayed.add(action)}
  fun removeCallbacksAndMessages(token: Any?) {pending.clear(); delayed.clear(); events.add("clear")}
  fun runPending() {val copy = pending.toList(); pending.clear(); copy.forEach {it()}}
  fun runDelayed() {val copy = delayed.toList(); delayed.clear(); copy.forEach {it.run()}}
}
class Animation(val events: MutableList<String>) {
  fun cancel() {events.add("animation_cancelled")}
}
class Card(val events: MutableList<String>) {fun animate() = Animation(events)}
class Request(val events: MutableList<String>) {
  var cancelled = false
  fun cancel() {cancelled = true; events.add("cancel")}
}
class Diagnostics(val events: MutableList<String>) {
  var terminal = false
  var outcome: String? = null
  var terminalCount = 0
  var stopped = false
  val phases = mutableListOf<Triple<String, Boolean, Boolean>>()
  fun finish(result: String? = null) {
    if (terminal) return
    terminal = true; terminalCount++; outcome = result; events.add("diagnostics")
  }
  fun lifecycle(phase: String, success: Boolean, finishing: Boolean) {
    check(!stopped); phases.add(Triple(phase, success, finishing)); events.add(phase)
  }
  fun shutdown() {stopped = true; events.add("shutdown")}
}
class ShareActivity: Activity() {
  val requestMutex = Any()
  var active = true
  var connection: Request? = null
  var diagnostics: Diagnostics? = Diagnostics(events)
  var completedResult: String? = null
  var resumed = false
  lateinit var card: Card
  val executor = Executors.newSingleThreadExecutor()
  val main = Handler(events)
  val shown = mutableListOf<String>()
  val closeSuccessfulShare = Runnable {finishImmediately()}
  init {card = Card(events)}
  fun showResult(result: String) {shown.add(result); if (result == "ok") main.postDelayed(closeSuccessfulShare, ${schedule[1]})}
  fun complete(result: String) = completeShare(result)
  ${method('private fun completeShare(result: String)')}
  ${method('override fun onResume()')}
  ${method('override fun onPause()')}
  ${method('override fun onNewIntent(intent: Intent)')}
  ${method('private fun finishImmediately()')}
  ${method('private fun cancelRequest()')}
  ${method('override fun onDestroy()')}
}
fun verifySuccess(activity: ShareActivity) {
  check(activity.isFinishing && activity.finishes == 1 && !activity.active)
  check(activity.main.pending.isEmpty() && activity.main.delayed.isEmpty())
  check(activity.diagnostics!!.outcome == "ok" && activity.diagnostics!!.terminalCount == 1)
  activity.onPause(); activity.onResume(); check(activity.finishes == 1)
  activity.onDestroy()
  check(activity.diagnostics!!.outcome == "ok" && activity.diagnostics!!.terminalCount == 1)
  check(activity.diagnostics!!.phases.map {it.first} == listOf("finish_requested", "destroyed"))
  check(activity.diagnostics!!.phases.all {it.second})
  check(activity.diagnostics!!.phases.last().third && activity.diagnostics!!.stopped)
  check(activity.executor.isShutdown)
}
fun main() {
  for (state in listOf("collecting", "success", "failed", "dismissing")) {
    for (index in 1..3) {
      val old = ShareActivity()
      old.active = state != "dismissing"
      val request = if (state == "collecting") Request(old.events) else null
      old.connection = request
      old.main.pending.add {error("stale callback")}
      old.main.delayed.add(Runnable {error("stale dismissal")})
      val incoming = Intent("android.intent.action.SEND", "text/plain", mutableMapOf("text" to "https://example.test/$index", "subject" to "Title $index"), 0x10000000)
      incoming.target = Activity::class.java
      old.onNewIntent(incoming)
      check(!old.active && old.connection == null && old.isFinishing)
      check(request == null || request.cancelled)
      check(old.main.pending.isEmpty() && old.main.delayed.isEmpty())
      check(old.events.first() == "super" && old.events.takeLast(2) == listOf("finish", "start"))
      val next = old.dispatched.single()
      check(next !== incoming && next.action == incoming.action && next.type == incoming.type)
      check(next.flags == incoming.flags && next.extras == incoming.extras)
      check(next.target == ShareActivity::class.java && incoming.target == Activity::class.java)
      incoming.extras["text"] = "changed"
      check(next.extras["text"] == "https://example.test/$index")
      old.complete("ok"); check(old.main.pending.isEmpty())
      old.onDestroy()
    }
  }
  val foreground = ShareActivity(); foreground.onResume(); foreground.complete("ok")
  check(foreground.diagnostics!!.outcome == "ok" && foreground.shown.isEmpty())
  foreground.main.runPending(); check(foreground.shown == listOf("ok") && !foreground.isFinishing)
  foreground.main.runDelayed(); verifySuccess(foreground)

  val lockedPending = ShareActivity(); lockedPending.onResume()
  val request = Request(lockedPending.events); lockedPending.connection = request
  lockedPending.onPause(); check(lockedPending.active && !request.cancelled && !lockedPending.isFinishing)
  lockedPending.complete("ok"); lockedPending.main.runPending(); check(lockedPending.shown.isEmpty()); verifySuccess(lockedPending)

  val lockDuringSuccess = ShareActivity(); lockDuringSuccess.onResume(); lockDuringSuccess.complete("ok"); lockDuringSuccess.main.runPending()
  lockDuringSuccess.onPause(); verifySuccess(lockDuringSuccess)

  val lockBeforeUi = ShareActivity(); lockBeforeUi.onResume(); lockBeforeUi.complete("ok")
  lockBeforeUi.onPause(); check(lockBeforeUi.shown.isEmpty()); verifySuccess(lockBeforeUi)

  val resumeBeforeUi = ShareActivity(); resumeBeforeUi.onResume(); resumeBeforeUi.onPause(); resumeBeforeUi.complete("ok")
  resumeBeforeUi.onResume(); check(resumeBeforeUi.shown.isEmpty()); verifySuccess(resumeBeforeUi)

  val background = ShareActivity(); background.complete("ok"); background.main.runPending(); verifySuccess(background)

  val failed = ShareActivity(); failed.onResume(); failed.onPause(); failed.complete("Failed"); failed.main.runPending()
  failed.onResume(); check(failed.active && !failed.isFinishing && failed.diagnostics!!.outcome == "Failed"); failed.onDestroy()
  check(failed.diagnostics!!.outcome == "Failed" && failed.diagnostics!!.terminalCount == 1)
  println("Production share lifecycle passed: 12 replacements and 7 completion scenarios")
}
`;
    const file = path.join(output, 'Host.kt'), jar = path.join(output, 'host.jar');
    writeFileSync(file, host);
    execFileSync(process.env.SLAX_KOTLINC ?? 'kotlinc', ['-include-runtime', '-d', jar, file], {encoding: 'utf8', timeout: 120000});
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
    const result = execFileSync(java, ['-jar', jar], {encoding: 'utf8', timeout: 30000});
    assert.match(result, /Production share lifecycle passed: 12 replacements and 7 completion scenarios/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
