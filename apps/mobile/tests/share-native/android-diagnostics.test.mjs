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

test('Android share preserves transport contract and guards dispatch after dismissal', () => {
  assert.match(read('build.gradle'), /implementation 'com.squareup.okhttp3:okhttp:4\.9\.2'/);
  assert.match(activity, /connectTimeout\(8, TimeUnit.SECONDS\)\.readTimeout\(15, TimeUnit.SECONDS\)\.writeTimeout\(15, TimeUnit.SECONDS\)/);
  assert.match(activity, /followRedirects\(false\)\.followSslRedirects\(false\)\.retryOnConnectionFailure\(true\)/);
  assert.ok(activity.includes('.protocols(listOf(okhttp3.Protocol.HTTP_1_1))'));
  assert.match(activity, /override fun isOneShot\(\) = true/);
  assert.match(activity, /override fun writeTo\(sink: BufferedSink\) \{if \(!active\) throw CancellationException/);
  assert.match(activity, /synchronized\(requestMutex\) \{\s*if \(!active\) \{request.cancel\(\); throw CancellationException/);
  assert.match(activity, /active = false; diagnostics\?\.finish\(\); connection.also/);
  assert.match(activity, /request\?\.cancel\(\)/);
  assert.doesNotMatch(activity, /HttpURLConnection|\.disconnect\(\)/);
});

test('Android share retains leading URL extraction, UI messages, payload and Firebase', () => {
  assert.ok(activity.includes('Regex("^((https|http)?://)'));
  for (const message of ['Collecting', 'Success!', 'Not support content', 'Not have share content', 'Not have URL content to collect.', 'Not have auth info, please login first.', 'Auth expired, please reopen the app to login again.', 'Request timed out, please try again.', 'Network unavailable, please check your connection.', 'Collection failed, please try again.']) assert.ok(activity.includes(`"${message}"`), message);
  assert.match(activity, /200, 204 -> "ok"/);
  assert.match(activity, /JSONObject\(reader.readText\(\)(\.also \{diagnostics\?\.http\(code, it, cfRay\)\})?\)\.optString\("message"\)\}\.onFailure/);
  assert.match(activity, /header\("Authorization", "Bearer \$token"\)/);
  assert.ok(activity.includes('header("User-Agent", "SlaxReader/Android $version")'));
  assert.match(activity, /put\("target_url", url\)/);
  assert.match(activity, /put\("target_title", it\)/);
  assert.match(activity, /main.postDelayed\(\{dismiss\(\)\}, 2000\)/);
  assert.match(activity, /bookmark_add_start/);
  assert.match(activity, /report\(false, version, null\)/);
});

test('Android terminal logging is independent, bounded and credential-redacted', () => {
  assert.match(activity, /diagnostics = ShareDiagnostics.create\(this\)/);
  assert.match(activity, /diagnostics\?\.finish\(result\); showResult\(result\)/);
  assert.match(activity, /executor.shutdownNow\(\); diagnostics\?\.shutdown\(\)/);
  assert.match(diagnostics, /if \(terminal\) return\s*terminal = true/);
  assert.match(diagnostics, /Executors.newSingleThreadExecutor\(\)/);
  assert.match(diagnostics, /executor.shutdown\(\)/);
  assert.doesNotMatch(diagnostics, /shutdownNow/);
  assert.match(diagnostics, /File\(activity.filesDir, "diagnostics"\)/);
  assert.match(diagnostics, /\$date.share-android.ndjson/);
  assert.match(diagnostics, /FileOutputStream\(file, true\)\.use \{it.write\(bytes\)\}/);
  assert.match(diagnostics, /file.length\(\) >= ShareDiagnosticRecord.DAILY_ALLOWANCE/);
  assert.match(diagnostics, /log.truncated/);
  assert.match(diagnostics, /writeFailures >= 3/);
  assert.doesNotMatch(diagnostics, /peekBody|okhttp3.Response|fun response\(/);
  assert.doesNotMatch(activity, /peekBody/);
  assert.equal((activity.match(/byteStream\(\)/g) ?? []).length, 1);
  assert.match(activity, /400 -> response.body\?\.byteStream\(\)\?\.bufferedReader\(\)\?\.use \{reader -> runCatching \{JSONObject\(reader.readText\(\)\.also \{diagnostics\?\.http\(code, it, cfRay\)\}\)\.optString\("message"\)\}/);
  assert.match(activity, /diagnostics\?\.http\(code, null, cfRay\)/);
  assert.match(activity, /finally \{request.cancel\(\); runCatching \{response\?\.close\(\)\};/);
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
  assert.match(activity, /eventListenerFactory/);
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
