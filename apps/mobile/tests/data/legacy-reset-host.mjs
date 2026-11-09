import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const output = mkdtempSync(resolve(tmpdir(), 'slax-legacy-reset-'));
const source = path => fileURLToPath(new URL(path, import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, {stdio: 'inherit', timeout: 120000});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Legacy reset host failed: ${result.status}`);
}
try {
  const jar = resolve(output, 'reset.jar');
  run(process.env.SLAX_KOTLINC ?? 'kotlinc', ['-include-runtime', '-d', jar, source('../../modules/slax-legacy/android/src/main/java/com/slax/reader/legacy/LegacyReset.kt'), source('./legacy-reset-host.kt')]);
  run(process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java') : 'java', ['-jar', jar, output]);
  if (process.platform === 'darwin') {
    const binary = resolve(output, 'reset-swift');
    run('xcrun', ['swiftc', source('../../modules/slax-legacy/ios/LegacyReset.swift'), source('./legacy-reset-host.swift'), '-o', binary]);
    run(binary, [output]);
  }
} finally {rmSync(output, {recursive: true, force: true});}
