import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const json = process.env.SLAX_JSON_CLASSPATH;
if (!json) throw new Error('Set SLAX_JSON_CLASSPATH to the installed public org.json jar');
const output = mkdtempSync(resolve(tmpdir(), 'slax-installation-host-'));
const jar = resolve(output, 'host.jar');
const java = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java') : 'java';
function run(command, args) {
  const result = spawnSync(command, args, {stdio: 'inherit', timeout: 120000});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Installation native host failed: ${result.status}`);
}
try {
  run(process.env.SLAX_KOTLINC ?? 'kotlinc', ['-include-runtime', '-classpath', json, '-d', jar,
    fileURLToPath(new URL('../../modules/slax-legacy/android/src/main/java/com/slax/reader/legacy/InstallationDatabase.kt', import.meta.url)),
    fileURLToPath(new URL('./installation-native-host.kt', import.meta.url))]);
  run(java, ['-cp', [jar, json].join(delimiter), 'com.slax.reader.legacy.Installation_native_hostKt', output]);
} finally {rmSync(output, {recursive: true, force: true});}
