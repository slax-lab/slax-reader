import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir, homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractPreferenceBodies} from './preference-probe-source.mjs';

const platform = process.argv[2];
assert(process.argv.length === 3 && ['ios', 'android'].includes(platform), 'Choose only ios or android; this command never accesses a device');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const relative = platform === 'android' ? 'modules/slax-legacy/android/src/main/java/com/slax/reader/legacy/SlaxLegacyModule.kt' : 'modules/slax-legacy/ios/SlaxLegacyModule.swift';
const sourcePath = path.join(root, relative), source = readFileSync(sourcePath, 'utf8');
const sourceSHA256 = createHash('sha256').update(source).digest('hex'), bodies = extractPreferenceBodies(source, platform);
const extension = platform === 'android' ? 'kt' : 'swift';
const templatePath = fileURLToPath(new URL(`../native/PreferenceProbe.template.${extension}`, import.meta.url));
const template = readFileSync(templatePath, 'utf8');
const generated = template.replaceAll('@@LOCKING_AND_SNAPSHOT@@', bodies.lockingAndSnapshot).replaceAll('@@JSON_MAP@@', bodies.jsonMap).replaceAll('@@COMPARE_AND_SWAP@@', bodies.compareAndSwap).replaceAll('@@SOURCE_SHA256@@', sourceSHA256);
assert(!generated.includes('@@'), 'Unexpanded fixture source placeholder');
const output = mkdtempSync(path.join(tmpdir(), 'slax-native-preference-probe-'));
const file = path.join(output, `PreferenceProbe.${extension}`); writeFileSync(file, generated);
const run = (command, args) => {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024});
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
let executable, compilerArtifacts;
const lifecyclePath = path.join(root, 'modules/slax-legacy/ios/StorageLifecycle.swift');
const lifecycleSources = platform === 'ios' ? [{path: lifecyclePath, sha256: createHash('sha256').update(readFileSync(lifecyclePath)).digest('hex')}] : [];
if (platform === 'ios') {
  const sdk = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']);
  executable = path.join(output, 'SlaxPreferenceProbe');
  run('xcrun', ['swiftc', '-sdk', sdk, '-target', 'arm64-apple-ios16.4-simulator', '-parse-as-library', file, lifecyclePath, '-o', executable]);
  run('codesign', ['--force', '--sign', '-', executable]);
} else {
  const compiler = process.env.SLAX_KOTLIN_COMPILER_CLASSPATH, stdlib = process.env.SLAX_KOTLIN_STDLIB;
  assert(compiler && stdlib, 'Supply the already cached public Kotlin compiler classpath and standard library; no dependency fetch is performed');
  const publicCache = path.join(homedir(), '.gradle/caches/modules-2/files-2.1');
  compilerArtifacts = [...new Set([...compiler.split(path.delimiter), stdlib])].map(file => {
    assert(file.startsWith(publicCache + '/') && realpathSync(file) === file && file.endsWith('.jar'), 'Only regular public Gradle-cache compiler jars are accepted');
    return {path: file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex')};
  });
  const sdk = process.env.ANDROID_HOME || path.join(homedir(), 'Library/Android/sdk');
  const tools = readdirSync(path.join(sdk, 'build-tools')).filter(name => /^\d+(?:\.\d+)*$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).at(-1);
  assert(tools, 'Installed Android build tools are required');
  const java = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;
  const androidJar = path.join(sdk, 'platforms/android-36/android.jar');
  const classes = path.join(output, 'classes'); mkdirSync(classes);
  run(java('java'), ['-Xmx512m', '-cp', compiler, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '1.8', '-classpath', [stdlib, androidJar].join(path.delimiter), '-d', classes, file]);
  const jar = path.join(output, 'preference-probe.jar'); run(java('jar'), ['cf', jar, '-C', classes, '.']);
  executable = path.join(output, 'preference-probe-dex.jar');
  run(path.join(sdk, 'build-tools', tools, 'd8'), ['--min-api', '26', '--lib', androidJar, '--output', executable, jar, stdlib]);
}
const marker = {kind: 'slax-controlled-native-preference-probe', version: 1, platform, output, executable, executableSHA256: createHash('sha256').update(readFileSync(executable)).digest('hex'), sourcePath, sourceSHA256, templatePath, templateSHA256: createHash('sha256').update(template).digest('hex'), literalBodySHA256: bodies.hashes, lifecycleSources, compilerArtifacts, directoryResolutionOverride: 'Only the explicitly guarded original-service synthetic fixture store', expoCallbackWrapperReplaced: true, productionBodiesModified: false, deviceExecuted: false};
writeFileSync(path.join(output, 'fixture-owner.json'), JSON.stringify(marker, null, 2) + '\n');
console.log(JSON.stringify(marker, null, 2));
