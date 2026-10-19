import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root = '/Users/daguang/.codex/worktrees/expo-mobile-migration/slax-reader';
const device = '88E63005-F681-45A6-AF8D-BEFE4E27584D';
const ownerRoot = '/private/var/folders/_l/80rthvqs2251jkn7spm33_s40000gn/T/slax-native-visible-upgrade-ios-waradJ';
const project = '/private/var/folders/_l/80rthvqs2251jkn7spm33_s40000gn/T/slax-visible-upgrade-ui-LEePuR';
const read = file => {assert(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink()); return JSON.parse(readFileSync(file));};
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const command = (bin, args) => {
  const result = spawnSync(bin, args, {encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024});
  assert.equal(result.status, 0, `${bin} guard failed`); return result.stdout.trim();
};
const owner = read(ownerRoot + '/fixture-owner.json');
assert(realpathSync(ownerRoot) === ownerRoot && owner.kind === 'slax-controlled-native-visible-upgrade-ios' && owner.version === 1 && owner.device === device && owner.runId === 'controlled-ios-visible-upgrade-v2-20261011');
const all = JSON.parse(command('xcrun', ['simctl', 'list', 'devices', '-j']));
const states = Object.values(all.devices).flat();
assert(states.find(value => value.udid === device)?.state === 'Booted');
assert(!states.some(value => value.state === 'Booted' && value.name.startsWith('Slax') && value.udid !== device));
const container = command('xcrun', ['simctl', 'get_app_container', device, 'app.slax.reader', 'data']);
const paths = read('/tmp/slax-visible-upgrade-v2-ios-paths.json');
assert(container === paths.container && paths.device === device && paths.directory === path.join(container, 'Library/Application Support'));
assert(!existsSync(path.join(paths.directory, 'native-upgrade-ui-request.json')));
const review = read(root + '/retired-evidence');
for (const input of review.sourceInputs) assert.equal(sha(root + '/' + input.path), input.sha256, 'Reviewed input changed before fresh native run');
const inputs = [...review.sourceInputs.map(value => value.path), ...[
  'src/components/SourceUI.tsx', 'src/components/source-font-scaling.ts', 'src/App.tsx', 'src/data/runtime.ts', 'src/data/adoption-profile.ts',
  'tests/data/NativeUpgradeVisibleFixtureApp.tsx', 'tests/data/NativeAdoptionFixtureApp.tsx', 'tests/data/adoption-fixtures/tooling/visible-upgrade-control.mjs',
].map(value => 'apps/mobile/' + value)];
const sourceInputHashes = Object.fromEntries([...new Set(inputs)].map(file => [file, sha(root + '/' + file)]));
const metro = await fetch('http://127.0.0.1:8084/status');
assert(metro.ok && (await metro.text()) === 'packager-status:running');
const bundle = await fetch('http://127.0.0.1:8084/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false');
assert(bundle.ok, 'The current Metro bundle must be available before writing a fresh request');
const bundleText = await bundle.text();
assert(bundleText.includes('sourceMarkClicks') && bundleText.includes('sourceSpToDp') && bundleText.includes('controlled-visible-upgrade-request'), 'Current passive input and UI source must be present in Metro');
const installed = command('xcrun', ['simctl', 'get_app_container', device, 'app.slax.reader', 'app']);
assert.equal(sha(path.join(installed, 'SlaxReader')), 'afca590846175cce828b550f5c92b17096b706c214de67ea1d6d1a380eebd97f');
const helper = read(project + '/fixture-owner.json');
assert(helper.kind === 'slax-controlled-visible-upgrade-ui' && helper.device === device && helper.runId === owner.runId && helper.dataDeviceOwner === ownerRoot && !helper.appGroupEntitlement && !helper.mainAppLaunchedByTest && !helper.databaseOrPreferencesModifiedByHost);
const output = ownerRoot + '/passive-input-v2'; assert(!existsSync(output)); mkdirSync(output);
const controller = root + '/apps/mobile/tests/data/adoption-fixtures/tooling/visible-upgrade-control.mjs';
const result = command('node', [controller, '--platform', 'ios', '--device', device, '--owner-directory', ownerRoot, '--request']);
const request = read(path.join(paths.directory, 'native-upgrade-ui-request.json'));
assert(request.device === device && request.runId === owner.runId && /^[0-9a-f-]{36}$/.test(request.nonce));
const marker = {kind: 'slax-controlled-visible-passive-input-run', version: 1, device, runId: owner.runId, nonce: request.nonce, requestedAt: request.requestedAt, directory: paths.directory, ownerRoot, output, sourceInputHashes,
  helperProject: project, helperEmbeddedPreviousNonce: helper.nonce, helperNonceScope: 'The retained helper only asserts its embedded nonce is nonempty; the external controller binds and rechecks the fresh live request/context/native owner before and after every test.',
  helperExecutableSHA256: sha(project + '/DerivedData/Build/Products/Debug-iphonesimulator/UpgradeVisibleControl-Runner.app/PlugIns/UpgradeVisibleControl.xctest/UpgradeVisibleControl'),
  helperHostExecutableSHA256: sha(project + '/DerivedData/Build/Products/Debug-iphonesimulator/UpgradeVisibleHost.app/UpgradeVisibleHost'),
  retainedMainExecutableSHA256: sha(path.join(installed, 'SlaxReader')), retainedMainDebugLibrarySHA256: sha(path.join(installed, 'SlaxReader.debug.dylib')),
  metroBundleSha256: createHash('sha256').update(bundleText).digest('hex'), noNativeBuild: true, noInjectedRowsHtmlPositionOrDomEvents: true, networkForwarded: 0};
writeFileSync(output + '/fixture-run.json', JSON.stringify(marker, null, 2) + '\n', {flag: 'wx'});
writeFileSync(output + '/native-upgrade-ui-request.json', JSON.stringify(request, null, 2) + '\n', {flag: 'wx'});
const launch = command('xcrun', ['simctl', 'launch', device, 'app.slax.reader']);
assert(/^app\.slax\.reader: [0-9]+$/.test(launch));
marker.mainPid = Number(launch.split(': ')[1]);
let context;
const getContext = () => {try {const value = read(paths.directory + '/native-upgrade-ui-context.json'); return value.nonce === request.nonce ? value : null;} catch {return null;}};
for (let i = 0; i < 20; i++) {context = getContext(); if (context) break; await new Promise(resolve => setTimeout(resolve, 500));}
if (!context) {
  command('xcrun', ['simctl', 'openurl', device, 'slaxreader://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8084']);
  for (let i = 0; i < 60; i++) {context = getContext(); if (context) break; await new Promise(resolve => setTimeout(resolve, 500));}
}
assert(context?.nonce === request.nonce && context.requestedAt === request.requestedAt && context.realProductionRoutesMounted && context.normalRuntimeReady && context.networkRequestsForwarded === 0 && !context.fixtureOnlyProviderUsed && !context.simulatedUiRowsOrHtml && context.actualNativeResourceOwner);
for (const [file, digest] of Object.entries(sourceInputHashes)) assert.equal(sha(root + '/' + file), digest, 'Source changed during launch');
marker.actualNativeResourceOwner = context.actualNativeResourceOwner;
marker.actualMainPid = marker.mainPid;
writeFileSync(output + '/launched.json', JSON.stringify(marker, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({device, nonce: request.nonce, nativeOwner: context.actualNativeResourceOwner, mainPid: marker.mainPid, sourceInputs: Object.keys(sourceInputHashes).length, output, freshNormalRuntimeMounted: true}));
