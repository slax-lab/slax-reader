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

test('production Android new-intent handoff retires old work and preserves each replacement payload', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-intent-'));
  try {
    const host = `
class Intent(val action: String, val type: String, val extras: MutableMap<String, String>, var flags: Int) {
  var target: Class<*>? = null
  constructor(other: Intent): this(other.action, other.type, other.extras.toMutableMap(), other.flags) {target = other.target}
  fun setClass(context: Any, target: Class<*>) = apply {this.target = target}
}
open class Activity {
  val events = mutableListOf<String>()
  var finished = false
  val dispatched = mutableListOf<Intent>()
  open fun onNewIntent(intent: Intent) {events.add("super")}
  fun finish() {finished = true; events.add("finish")}
  fun startActivity(intent: Intent) {check(finished); events.add("start"); dispatched.add(intent)}
}
class Handler(val events: MutableList<String>) {
  val pending = mutableListOf<() -> Unit>()
  fun removeCallbacksAndMessages(token: Any?) {pending.clear(); events.add("clear")}
}
class Request(val events: MutableList<String>) {
  var cancelled = false
  fun cancel() {cancelled = true; events.add("cancel")}
}
class Diagnostics(val events: MutableList<String>) {
  var finishes = 0
  fun finish() {finishes++; events.add("diagnostics")}
}
class ShareActivity: Activity() {
  val requestMutex = Any()
  var active = true
  var connection: Request? = null
  var diagnostics: Diagnostics? = Diagnostics(events)
  val main = Handler(events)
  ${method('override fun onNewIntent(intent: Intent)')}
  ${method('private fun cancelRequest()')}
}
fun main() {
  for (state in listOf("collecting", "success", "failed", "dismissing")) {
    var activity = ShareActivity()
    for (index in 1..3) {
      val old = activity
      old.active = state != "dismissing"
      val request = if (state == "collecting") Request(old.events) else null
      old.connection = request
      var staleCallbacks = 0
      old.main.pending.add {staleCallbacks++}
      val incoming = Intent("android.intent.action.SEND", "text/plain", mutableMapOf("text" to "https://example.test/$index", "subject" to "Title $index"), 0x10000000)
      incoming.target = Activity::class.java
      old.onNewIntent(incoming)
      check(!old.active && old.connection == null && old.finished)
      check(request == null || request.cancelled)
      check(old.diagnostics!!.finishes == 1)
      check(old.main.pending.isEmpty() && staleCallbacks == 0)
      check(old.events.first() == "super" && old.events.takeLast(3) == listOf("clear", "finish", "start"))
      check(old.dispatched.size == 1)
      val next = old.dispatched.single()
      check(next !== incoming && next.action == incoming.action && next.type == incoming.type)
      check(next.flags == incoming.flags && next.extras == incoming.extras)
      check(next.target == ShareActivity::class.java && incoming.target == Activity::class.java)
      incoming.extras["text"] = "changed"
      check(next.extras["text"] == "https://example.test/$index")
      activity = ShareActivity()
      check(activity.active && activity.dispatched.isEmpty())
    }
  }
  println("Production intent handoff passed: 12 replacements across collecting/success/failed/dismissing")
}
`;
    const file = path.join(output, 'Host.kt'), jar = path.join(output, 'host.jar');
    writeFileSync(file, host);
    execFileSync(process.env.SLAX_KOTLINC ?? 'kotlinc', ['-include-runtime', '-d', jar, file], {encoding: 'utf8', timeout: 120000});
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
    const result = execFileSync(java, ['-jar', jar], {encoding: 'utf8', timeout: 30000});
    assert.match(result, /Production intent handoff passed: 12 replacements/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
