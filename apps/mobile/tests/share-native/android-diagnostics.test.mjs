import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../../native/share/tests/android-diagnostics.test.cjs';

const root = new URL('../../modules/slax-share/android/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const source = name => read(`src/main/java/com/slax/reader/extension/${name}.kt`);
const activity = source('ShareActivity');
const diagnostics = source('ShareDiagnostics');
const record = source('ShareDiagnosticRecord');
const timings = source('ShareNetworkTimings');
const transport = source('ShareSaveTransport');

test('Android activity owns cancellable transport with bounded create and exists calls', () => {
  assert.match(read('build.gradle'), /implementation 'com.squareup.okhttp3:okhttp:4\.9\.2'/);
  assert.match(transport, /callTimeout\(5, TimeUnit.SECONDS\)/);
  assert.match(transport, /callTimeout\(3, TimeUnit.SECONDS\)/);
  assert.match(transport, /followRedirects\(false\)\.followSslRedirects\(false\)\.retryOnConnectionFailure\(true\)/);
  assert.match(transport, /retryOnConnectionFailure\(false\)\.eventListener\(EventListener.NONE\)/);
  assert.ok(transport.includes('.protocols(listOf(Protocol.HTTP_1_1))'));
  assert.match(transport, /override fun isOneShot\(\) = true/);
  assert.ok(transport.includes('request(base, "/v1/bookmark/exists", token, version, JSONObject().put("target_url", url))'));
  assert.ok(transport.includes('if (response.code != 200) false'));
  assert.ok(transport.includes('optJSONObject("data")?.opt("exists") == true'));
  assert.doesNotMatch(transport, /save_receipt|optBoolean|getBoolean/);
  assert.match(activity, /private var connection: ShareSaveTransport\?/);
  assert.match(activity, /synchronized\(requestMutex\) \{\s*if \(!active\) \{request.cancel\(\); throw CancellationException/);
  assert.match(activity, /synchronized\(requestMutex\) \{active = false; connection\?\.cancel\(\); diagnostics\?\.finish\(\); connection = null\}/);
  assert.doesNotMatch(activity, /HttpURLConnection|\.disconnect\(\)/);
});

test('Android share retains leading URL extraction, UI messages, payload and Firebase', () => {
  assert.ok(activity.includes('Regex("^((https|http)?://)'));
  for (const message of ['Collecting', 'Success!', 'Not support content', 'Not have share content', 'Not have URL content to collect.', 'Not have auth info, please login first.', 'Auth expired, please reopen the app to login again.', 'Request timed out, please try again.', 'Network unavailable, please check your connection.', 'Collection failed, please try again.']) assert.ok((activity + transport).includes(`"${message}"`), message);
  assert.match(transport, /200, 204 -> "ok"/);
  assert.match(transport, /JSONObject\(it\)\.optString\("message"\)/);
  assert.match(transport, /header\("Authorization", "Bearer \$token"\)/);
  assert.ok(transport.includes('header("User-Agent", "SlaxReader/Android $version")'));
  assert.match(transport, /put\("target_url", url\)/);
  assert.match(transport, /put\("target_title", title\)/);
  assert.match(activity, /private val closeSuccessfulShare = Runnable \{ finishImmediately\(\) \}/);
  assert.match(activity, /if \(success\) main.postDelayed\(closeSuccessfulShare, 2000\)/);
  const close = activity.slice(activity.indexOf('  private fun finishImmediately()'), activity.indexOf('  private fun label('));
  assert.match(close, /main.removeCallbacksAndMessages\(null\)/);
  assert.match(close, /card.animate\(\).cancel\(\)/);
  assert.match(close, /finish\(\)/);
  assert.doesNotMatch(close, /withEndAction|postDelayed/);
  assert.match(activity, /bookmark_add_start/);
  assert.match(activity, /report\(false, version, null\)/);
});

test('Android terminal logging is independent, bounded and credential-redacted', () => {
  assert.match(activity, /diagnostics = ShareDiagnostics.create\(this\)/);
  const completion = activity.slice(activity.indexOf('  private fun completeShare('), activity.indexOf('  override fun onResume()'));
  assert.match(completion, /diagnostics\?\.finish\(result\)\s*completedResult = result/);
  assert.match(completion, /main.post/);
  assert.ok(completion.indexOf('diagnostics?.finish(result)') < completion.indexOf('main.post'));
  const destruction = activity.slice(activity.indexOf('  override fun onDestroy()'), activity.indexOf('private object LegacyStringPreferences'));
  assert.match(destruction, /executor.shutdownNow\(\)/);
  assert.match(destruction, /diagnostics\?\.lifecycle\("destroyed", completedResult == "ok", isFinishing\)\s*diagnostics\?\.shutdown\(\)/);
  assert.match(diagnostics, /if \(terminal\) return\s*terminal = true/);
  assert.match(diagnostics, /Executors.newSingleThreadExecutor\(\)/);
  assert.match(diagnostics, /executor.shutdown\(\)/);
  assert.doesNotMatch(diagnostics, /shutdownNow/);
  assert.match(diagnostics, /File\(activity.filesDir, "diagnostics"\)/);
  assert.match(diagnostics, /\$date.share-android.ndjson/);
  assert.match(diagnostics, /FileOutputStream\(file, true\)\.use \{\s*it.write\(bytes\)/);
  assert.match(diagnostics, /if \(value.optString\("event"\) in setOf\("share.end", "share.lifecycle"\)\) it.fd.sync\(\)/);
  assert.match(diagnostics, /file.length\(\) >= ShareDiagnosticRecord.DAILY_ALLOWANCE/);
  assert.match(diagnostics, /log.truncated/);
  assert.match(diagnostics, /writeFailures >= 3/);
  assert.doesNotMatch(diagnostics, /peekBody|okhttp3.Response|fun response\(/);
  assert.doesNotMatch(activity + transport, /peekBody/);
  assert.equal((transport.match(/response.body\?\.string\(\)/g) ?? []).length, 2);
  assert.match(transport, /400 -> \{\s*val errorBody = try \{response.body\?\.string\(\)\}/);
  assert.match(activity, /diagnostics\?\.http\(code, body, cfRay\)/);
  assert.match(activity, /onCreateFinished = \{diagnostics\?\.requestFinished\(\)\}/);
  assert.match(transport, /finally \{\s*call.cancel\(\)\s*runCatching \{response\?\.close\(\)\}/);
  assert.match(transport, /eventListener\(EventListener.NONE\)/);
  assert.doesNotMatch(activity, /deferred|diagnostics\?\.response/);
  assert.match(record, /LINE_LIMIT = 4096/);
  assert.match(record, /DAILY_ALLOWANCE = 524288L/);
  assert.match(record, /value.length > 4\) put\("tail4", value.takeLast\(4\)\)/);
  assert.doesNotMatch(diagnostics + timings, /printStackTrace|println\(|Log\.[deiw]\(|error\.message|exception\.message/);
});

test('Android diagnostic initialization and IPC do not block lifecycle locks', () => {
  const initialization = diagnostics.slice(diagnostics.indexOf('  init {'), diagnostics.indexOf('  private fun execute'));
  assert.match(initialization, /init \{\s*execute \{/);
  for (const operation of ['getApplicationInfo', 'ShareDiagnosticRecord(', 'captureInput', 'captureNetworkNow()']) assert.ok(initialization.includes(operation), operation);
  const beforeInitialization = diagnostics.slice(0, diagnostics.indexOf('  init {'));
  assert.doesNotMatch(beforeInitialization, /getApplicationInfo|UUID|OffsetDateTime|Regex\(|getNetworkCapabilities/);
  const capture = diagnostics.slice(diagnostics.indexOf('  private fun captureNetworkNow'), diagnostics.indexOf('  fun finish'));
  assert.ok(capture.indexOf('getNetworkCapabilities') < capture.indexOf('synchronized(mutex)'));
  assert.match(capture, /synchronized\(mutex\) \{network = snapshot\}/);
  const finish = diagnostics.slice(diagnostics.indexOf('  fun finish'), diagnostics.indexOf('  private fun write'));
  assert.ok(finish.indexOf('execute {') < finish.indexOf('record.end('));
  assert.doesNotMatch(finish, /getApplicationInfo|getNetworkCapabilities|captureInput/);
  assert.match(record, /action\?\.take\(80\)/);
  assert.match(record, /mime\?\.take\(80\)/);
  assert.doesNotMatch(record + timings + diagnostics, /Double|1_000_000\.0/);
});

test('Android per-call phase and network-capability metadata is wired', () => {
  assert.match(activity, /listener = diagnostics\?\.let \{ShareNetworkListener\(it.timings\)\}/);
  assert.match(transport, /eventListener\(listener\)/);
  for (const phase of ['dns', 'connect', 'tls', 'send', 'wait', 'receive']) assert.ok(timings.includes(`"${phase}"`));
  for (const key of ['reused', 'proxy', 'protocol', 'tlsVersion', 'failedIn']) assert.ok(timings.includes(`"${key}"`));
  assert.match(timings, /connectionAcquired/);
  assert.match(timings, /Proxy.Type.DIRECT/);
  assert.match(read('src/main/AndroidManifest.xml'), /android.permission.ACCESS_NETWORK_STATE/);
  assert.match(diagnostics, /getNetworkCapabilities\(manager.activeNetwork\)/);
  assert.match(diagnostics, /NET_CAPABILITY_VALIDATED/);
  assert.match(diagnostics, /NET_CAPABILITY_NOT_METERED/);
  assert.match(diagnostics, /catch \(_: SecurityException\)/);
});
