const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, rmSync, readdirSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {homedir, tmpdir} = require('node:os');
const path = require('node:path');

function cachedJar(group, artifact, version) {
  const base = path.join(homedir(), '.gradle/caches/modules-2/files-2.1', group, artifact, version);
  try {
    const jars = readdirSync(base).flatMap(hash => readdirSync(path.join(base, hash)).filter(file => file === `${artifact}-${version}.jar` || file === `${artifact}-jvm-${version}.jar`).map(file => path.join(base, hash, file)));
    return jars.length === 1 ? jars[0] : null;
  } catch {return null;}
}
const jars = [
  cachedJar('com.squareup.okhttp3', 'okhttp', '4.9.2'),
  cachedJar('com.squareup.okio', 'okio', '2.8.0'),
  process.env.SLAX_JSON_CLASSPATH ?? cachedJar('org.json', 'json', '20180813'),
];
const classpath = process.env.SLAX_SHARE_TRANSPORT_CLASSPATH ?? (jars.every(Boolean) ? jars.join(path.delimiter) : null);

test('actual Kotlin share HTTP transport enforces deadlines, exists recovery and cancellation', {
  skip: !classpath && 'Supply SLAX_SHARE_TRANSPORT_CLASSPATH or populate the existing OkHttp 4.9.2, Okio 2.8.0 and org.json Gradle caches',
}, t => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-android-transport-'));
  try {
    const sources = ['ShareSaveTransport.kt', 'ShareRequestFailure.kt', 'ShareNetworkTimings.kt', 'ShareDiagnosticRecord.kt']
      .map(name => path.resolve(__dirname, '../../../modules/slax-share/android/src/main/java/com/slax/reader/extension', name));
    const jar = path.join(output, 'host.jar');
    execFileSync(process.env.SLAX_KOTLINC ?? 'kotlinc', ['-classpath', classpath, '-include-runtime', '-d', jar, ...sources, path.join(__dirname, 'android-transport-host.kt')], {encoding: 'utf8', timeout: 120000});
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
    const result = execFileSync(java, ['-cp', [jar, classpath].join(path.delimiter), 'com.slax.reader.extension.Android_transport_hostKt'], {encoding: 'utf8', timeout: 120000});
    assert.match(result, /Kotlin HTTP transport checks passed: 36 scenarios/);
    t.diagnostic(result.trim());
  } finally {rmSync(output, {recursive: true, force: true});}
});
