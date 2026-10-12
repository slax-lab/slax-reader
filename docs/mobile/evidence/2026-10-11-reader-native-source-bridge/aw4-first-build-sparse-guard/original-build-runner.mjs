import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statfsSync, statSync, writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';

const stage = '/private/var/folders/_l/80rthvqs2251jkn7spm33_s40000gn/T/slax-reader-ui-fixture-byWKU3';
const dd = '/tmp/slax-reader-nativebridge-ios-aw4-deriveddata';
const logRoot = '/tmp/slax-reader-nativebridge-ios-aw4-build';
const expectedMarker = process.argv[2];
assert.match(expectedMarker ?? '', /^[a-f0-9]{64}$/);
const markerPath = path.join(stage, '.slax-ui-fixture-project.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fileDigest = file => digest(readFileSync(file));
assert.equal(realpathSync(stage), stage);
assert.equal(fileDigest(markerPath), expectedMarker);
const marker = JSON.parse(readFileSync(markerPath));
assert.equal(marker.kind, 'slax-ui-fixture-project');
assert.equal(marker.version, 1);
assert.equal(marker.iosId, 'app.slax.reader.uifixture');
assert.equal(marker.projectRoot, stage);
assert.equal(marker.sourceMobileRoot, '/Users/daguang/.codex/worktrees/expo-mobile-migration/slax-reader/apps/mobile');
assert.ok(!existsSync(dd) && !existsSync(logRoot), 'New owned products/logs must not replace any retained directory');
const newProductBudget = Math.floor(2.8 * 1024 ** 3), minimumFree = 3 * 1024 ** 3;
const free = () => {const value = statfsSync(stage); return value.bavail * value.bsize;};
assert.ok(free() >= minimumFree);
for (const dir of [dd, logRoot]) mkdirSync(dir);
const owner = {kind: 'slax-reader-nativebridge-ui-build', version: 1, stage, markerSha256: expectedMarker, derivedData: dd, logRoot, identity: 'app.slax.reader.uifixture', arm64Only: true, jobs: 1, newProductBudget, minimumFree, noDeviceCalls: true};
writeFileSync(path.join(logRoot, 'owner.json'), JSON.stringify(owner, null, 2) + '\n');
const size = dir => {
  let result = 0;
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    try {result += entry.isDirectory() ? size(file) : statSync(file).size;} catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  return result;
};
const lockPaths = [path.join(stage, 'ios/Podfile.lock'), path.join(stage, 'ios/Pods/Manifest.lock')];
const locksBefore = lockPaths.map(file => ({path: file, sha256: fileDigest(file)}));
assert.equal(locksBefore[0].sha256, locksBefore[1].sha256);
const nativeFiles = ['SlaxReaderView.swift', 'SlaxReaderDocumentNavigationGate.swift'].map(file => path.join(stage, 'modules/slax-platform/ios', file));
const publicInputs = [markerPath, ...nativeFiles, path.join(stage, 'assets/embedded/js/react-native-host.js'), path.join(stage, 'src/reader/embedded.generated.ts'), path.join(stage, 'src/screens/ReaderScreen.tsx')].map(file => ({path: file, sha256: fileDigest(file)}));
const expectedNativeInputs = ['c0c727feb112265a4909ed7c7b5908d214e5ac867d2c85fb36dca6c9d7f38f66', '33cf869bf0a52541d101699c88e8701bb7888b14e34a37390b52582419c973d5'];
nativeFiles.forEach((file, index) => assert.equal(fileDigest(file), expectedNativeInputs[index]));
assert.equal(fileDigest(path.join(stage, 'src/screens/ReaderScreen.tsx')), '7103eb8e074b055a7e78690bdd62e6cc4d92622a6cde89c726623a0192c02805');
const samples = [];
let stopped = null;
const guard = () => {
  const sample = {at: Date.now(), freeBytes: free(), ownedBytes: size(dd) + size(logRoot)};
  samples.push(sample);
  if (sample.freeBytes < minimumFree) stopped = 'minimum-free-disk';
  if (sample.ownedBytes > newProductBudget) stopped = 'new-product-budget';
  if (fileDigest(markerPath) !== expectedMarker) stopped = 'stage-marker-changed';
  return !stopped;
};
async function run(command, args, name, milliseconds) {
  assert.ok(guard(), stopped ?? 'resource guard');
  const output = createWriteStream(path.join(logRoot, `${name}.log`), {flags: 'wx'});
  const child = spawn(command, args, {cwd: path.join(stage, 'ios'), detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  const stopOwnedGroup = () => {try {process.kill(-child.pid, 'SIGTERM');} catch (error) {if (error.code !== 'ESRCH') throw error;}};
  child.stdout.pipe(output, {end: false}); child.stderr.pipe(output, {end: false});
  const started = Date.now();
  const interval = setInterval(() => {if (!guard()) stopOwnedGroup();}, 3000);
  const timeout = setTimeout(() => {stopped = `${name}-time-budget`; stopOwnedGroup();}, milliseconds);
  const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', resolve);});
  clearInterval(interval); clearTimeout(timeout);
  await new Promise(resolve => output.end(resolve));
  writeFileSync(path.join(logRoot, `${name}-result.json`), JSON.stringify({command, args, exitCode: code, stopped, durationMs: Date.now() - started, lastSample: samples.at(-1)}, null, 2) + '\n');
  assert.equal(stopped, null); assert.equal(code, 0, `${name} failed; see own log`);
}
try {
  await run('pod', ['install', '--deployment'], 'pod', 240000);
  for (const input of locksBefore) assert.equal(fileDigest(input.path), input.sha256, 'Deployment must retain exact locks');
  const podsProject = path.join(stage, 'ios/Pods/Pods.xcodeproj/project.pbxproj');
  assert.ok(readFileSync(podsProject, 'utf8').includes('SlaxReaderDocumentNavigationGate.swift in Sources'), 'Actual Pods target must compile the production gate');
  await run('xcodebuild', ['-workspace', 'SlaxReader.xcworkspace', '-scheme', 'SlaxReader', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=NO', '-jobs', '1', '-derivedDataPath', dd, `CLANG_MODULE_CACHE_PATH=${dd}/ModuleCache.noindex`, 'build'], 'xcodebuild', 2700000);
  for (const input of publicInputs) assert.equal(fileDigest(input.path), input.sha256, 'Frozen build input changed');
  const app = path.join(dd, 'Build/Products/Debug-iphonesimulator/SlaxReader.app');
  assert.ok(lstatSync(app).isDirectory());
  await run('codesign', ['--force', '--deep', '--sign', '-', app], 'public-ad-hoc-sign', 60000);
  await run('codesign', ['--verify', '--deep', '--strict', app], 'signature-verification', 60000);
  assert.ok(guard(), stopped ?? 'resource guard');
  const report = {version: 1, ...owner, status: 'actual-arm64-debug-native-build-passed-not-installed', buildSucceeded: true, appPath: app, nativeExecutable: {path: path.join(app, 'SlaxReader'), sha256: fileDigest(path.join(app, 'SlaxReader'))}, nativeDebugDylib: {path: path.join(app, 'SlaxReader.debug.dylib'), sha256: fileDigest(path.join(app, 'SlaxReader.debug.dylib'))}, publicInputs, locksBefore, podsProject: {path: podsProject, sha256: fileDigest(podsProject)}, samples, noMainOrGroupAccess: true, nativeSelectionRetest: 'pending'};
  writeFileSync(path.join(logRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({status: report.status, reportPath: path.join(logRoot, 'report.json'), appPath: app, executable: report.nativeExecutable.sha256, debugDylib: report.nativeDebugDylib.sha256, finalSample: samples.at(-1)}));
} catch (error) {
  writeFileSync(path.join(logRoot, 'failed-report.json'), JSON.stringify({version: 1, ...owner, status: 'failed-not-installed', reason: stopped ?? String(error.message), samples, publicInputs, locksBefore, noDeviceCalls: true}, null, 2) + '\n');
  throw error;
}
