import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Supply public pinned Compose UI-unit and AndroidX collection jars from the sanitized source build.
const sourceLibraries = process.env.SLAX_SOURCE_UI_UNIT_CLASSPATH;
if (!sourceLibraries) throw new Error('Set SLAX_SOURCE_UI_UNIT_CLASSPATH to the pinned public UI-unit and collection jars.');
const compiler = process.env.SLAX_KOTLINC || 'kotlinc';
const java = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java') : 'java';
const temporary = mkdtempSync(resolve(tmpdir(), 'slax-source-text-scaling-'));
const output = resolve(temporary, 'scaling.jar');
function check(result) {if (result.error) throw result.error; if (result.status !== 0) throw new Error(`Native text host exited with ${result.status}`);}
try {
  check(spawnSync(compiler, ['-include-runtime', '-d', output,
    fileURLToPath(new URL('../../modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxTextScaling.kt', import.meta.url)),
    fileURLToPath(new URL('./native-text-scaling-host.kt', import.meta.url))], {stdio: 'inherit', timeout: 120000}));
  check(spawnSync(java, ['-cp', [output, sourceLibraries].join(delimiter), 'com.slax.reader.platform.Native_text_scaling_hostKt'], {stdio: 'inherit', timeout: 60000}));
} finally {rmSync(temporary, {recursive: true, force: true});}
