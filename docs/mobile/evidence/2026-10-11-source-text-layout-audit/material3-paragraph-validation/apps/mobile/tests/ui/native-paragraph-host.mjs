import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const sourceLibrary = process.env.SLAX_SOURCE_UI_TEXT_JAR;
if (!sourceLibrary) throw new Error('Set SLAX_SOURCE_UI_TEXT_JAR to the actual pinned public Compose UI-text classes jar.');
const compiler = process.env.SLAX_KOTLINC || 'kotlinc';
const java = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java') : 'java';
const temporary = mkdtempSync(resolve(tmpdir(), 'slax-native-paragraph-host-'));
const output = resolve(temporary, 'paragraph.jar');
function check(result) {if (result.error) throw result.error; if (result.status !== 0) throw new Error(`Native paragraph host exited with ${result.status}`);}
try {
  const files = ['../../modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxLineHeightSpan.kt', './native-paragraph-host/Paint.kt', './native-paragraph-host/LineHeightSpan.kt', './native-paragraph-host/Host.kt'].map(file => fileURLToPath(new URL(file, import.meta.url)));
  check(spawnSync(compiler, ['-J-Xmx512m', '-include-runtime', '-d', output, ...files], {stdio: 'inherit', timeout: 60000}));
  check(spawnSync(java, ['-Xmx256m', '-cp', [output, sourceLibrary].join(delimiter), 'com.slax.reader.platform.HostKt'], {stdio: 'inherit', timeout: 10000}));
} finally {rmSync(temporary, {recursive: true, force: true});}
