import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {upgradeVisibilityPhase, validateVisibleLegacyProducer, validatePreReconnectVisibility, validatePostServiceVisibility, sameControlledValue} from '../../../../src/controlled-upgrade-visibility.ts';
import {validatePreReconnectServiceBaseline} from '../../pre-reconnect-evidence.ts';

const options = {};
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  assert(['--platform', '--device', '--owner-directory', '--phase', '--request', '--status', '--cleanup'].includes(key), 'Unknown controlled visible-upgrade argument');
  options[key.slice(2)] = ['--request', '--status', '--cleanup'].includes(key) ? true : process.argv[++index];
}
const platform = options.platform, device = options.device;
const selectedPhase = upgradeVisibilityPhase(options.phase);
assert(['ios', 'android'].includes(platform) && (platform === 'ios' ? /^[0-9A-Fa-f-]{36}$/.test(device ?? '') : /^emulator-\d+$/.test(device ?? '')), 'Choose an explicit controlled simulator/emulator');
assert(['request', 'status', 'cleanup'].filter(key => options[key]).length === 1, 'Choose one controlled visible action');
assert(typeof options['owner-directory'] === 'string', 'The fresh fixture owner directory is required');
const ownerRoot = realpathSync(options['owner-directory']);
assert(path.dirname(ownerRoot) === realpathSync(tmpdir()) && new RegExp(`^slax-native-visible-upgrade-${platform}-[a-zA-Z0-9]+$`).test(path.basename(ownerRoot)), 'Only a fresh marked visible-upgrade device is accepted');
const regular = location => {assert(lstatSync(location).isFile() && !lstatSync(location).isSymbolicLink(), 'A regular controlled marker is required'); return location;};
const owner = JSON.parse(readFileSync(regular(path.join(ownerRoot, 'fixture-owner.json')), 'utf8'));
assert(owner.kind === `slax-controlled-native-visible-upgrade-${platform}` && owner.version === 1 && owner.device === device && /^[a-zA-Z0-9-]{1,64}$/.test(owner.runId), 'The fresh visible device owner does not match');
const command = (name, args, input, preserveOutput = false) => {
  const result = spawnSync(name, args, {input, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024});
  assert.equal(result.status, 0, `${name} controlled command failed`); return preserveOutput ? result.stdout : result.stdout.trim();
};
const adb = (...args) => command('adb', ['-s', device, ...args]);
let directory;
if (platform === 'ios') {
  const data = command('xcrun', ['simctl', 'get_app_container', device, 'app.slax.reader', 'data']);
  assert(realpathSync(data) === data && data.includes(`/CoreSimulator/Devices/${device}/data/Containers/Data/Application/`));
  directory = path.join(data, 'Library/Application Support');
} else directory = '/data/user/0/com.slax.reader/files';
const readText = name => {
  assert(/^[a-z-]+\.json$/.test(name), 'Only named controlled markers may be read');
  if (platform === 'android') {
    const resolved = adb('shell', 'run-as', 'com.slax.reader', 'readlink', '-f', `files/${name}`);
    assert(['/data/data/com.slax.reader/files/', '/data/user/0/com.slax.reader/files/'].some(prefix => resolved === prefix + name), 'Refuse a different sandbox or symlink');
    return command('adb', ['-s', device, 'shell', 'run-as', 'com.slax.reader', 'cat', `files/${name}`], undefined, true);
  }
  return readFileSync(regular(path.join(directory, name)), 'utf8');
};
const read = name => JSON.parse(readText(name));
const inputPath = fileURLToPath(new URL('../visible-legacy-inputs.json', import.meta.url));
const inputSHA256 = createHash('sha256').update(readFileSync(regular(inputPath))).digest('hex');
const exists = name => platform === 'ios' ? existsSync(path.join(directory, name)) : adb('shell', `run-as com.slax.reader sh -c 'test -f files/${name} && echo present || echo absent'`) === 'present';
const source = read('legacy-fixture-report.json');
assert(source.visibleInputsSHA256 === inputSHA256, 'The public producer input changed');
validateVisibleLegacyProducer(source, platform);
if (selectedPhase === 'pre-reconnect') {
  for (const name of ['native-service-report.json', 'native-adoption-report.json', 'native-runtime-start-report.json']) assert(!exists(name), 'Preserve prior acceptance; select only a fresh original queue');
} else {
  const service = read('native-service-report.json'), startup = read('native-runtime-start-report.json'), cas = read('native-preference-cas-report.json');
  validatePostServiceVisibility(platform, device, service, startup);
  assert(service.runId === owner.runId && cas.status === 'passed' && cas.device === device && cas.mode === 'lock-read' && cas.databaseUnchanged === true && cas.unrelatedPreferencesUnchanged === true, 'The exact service and preference-lock run must complete');
  const completedServiceReportMd5 = createHash('md5').update(readText('native-service-report.json')).digest('hex');
  assert(cas.completedServiceReportMd5 === completedServiceReportMd5 && startup.completedServiceReportMd5 === completedServiceReportMd5, 'Preference and normal-runtime proof must bind this exact completed service report');
}
const name = 'native-upgrade-ui-request.json';
if (options.request) {
  if (platform === 'android') assert(adb('shell', "run-as com.slax.reader sh -c 'test -f files/native-upgrade-ui-request.json && echo present || echo absent'") === 'absent', 'Remove the matching completed request before starting another visible run');
  else assert(!existsSync(path.join(directory, name)), 'Remove the matching completed request before starting another visible run');
  if (selectedPhase === 'pre-reconnect') assert(!exists('native-upgrade-offline-finished.json'), 'Preserve an earlier offline visibility run');
  const request = {kind: 'slax-controlled-visible-upgrade-request', version: 1, phase: selectedPhase, platform, device, runId: owner.runId, nonce: randomUUID(), requestedAt: Date.now(), visibleInputsSHA256: inputSHA256};
  const contents = JSON.stringify(request, null, 2) + '\n';
  if (platform === 'android') command('adb', ['-s', device, 'shell', "run-as com.slax.reader sh -c 'cat > files/native-upgrade-ui-request.json'"], contents);
  else {const target = path.join(directory, name); assert(!existsSync(target) || !lstatSync(target).isSymbolicLink()); writeFileSync(target, contents);}
  console.log(JSON.stringify({kind: request.kind, requestWritten: true, platform, device, nonce: request.nonce, visibleInputsSHA256: inputSHA256}));
} else {
  const requestText = readText(name), request = JSON.parse(requestText), context = read('native-upgrade-ui-context.json');
  assert(request.kind === 'slax-controlled-visible-upgrade-request' && request.version === 1 && request.device === device && request.platform === platform && request.runId === owner.runId && request.visibleInputsSHA256 === inputSHA256);
  assert(upgradeVisibilityPhase(request.phase) === selectedPhase && upgradeVisibilityPhase(context.phase) === selectedPhase, 'The live visibility phase changed');
  assert(context.kind === 'slax-controlled-visible-upgrade-context' && context.version === 1 && context.device === device && context.nonce === request.nonce && context.requestedAt === request.requestedAt && context.capturedAt >= request.requestedAt && context.realProductionRoutesMounted === true && context.simulatedUiRowsOrHtml === false && context.fixtureOnlyProviderUsed === false && context.explicitAdoptionEvidenceProvided === false && context.normalRuntimeReady === true && context.networkRequestsForwarded === 0 && context.actualNativeResourceOwner, 'The actual routes have not recorded this fresh request');
  console.log(JSON.stringify({kind: context.kind, platform, device, nonce: context.nonce, observedRoute: context.observedRoute, nativeInteractionAcceptance: 'requires separate native test/screenshot evidence', networkRequestsForwarded: 0}));
  if (options.cleanup) {
    if (selectedPhase === 'pre-reconnect') {
      const offline = read('native-upgrade-offline-report.json'), observations = read('native-upgrade-reader-lifecycle.json');
      validatePreReconnectVisibility(source, request, offline, context.actualNativeResourceOwner);
      assert(context.originalPendingQueueAndDataUnchanged === true && sameControlledValue(context.currentPending, source.transactions)
        && context.currentInspection?.pendingOperations === 4 && context.currentInspection.pendingTransactions === 2
        && context.currentInspection.queueDigest === offline.before.queueDigest && context.currentInspection.dataDigest === offline.before.dataDigest, 'The original queue changed during visible reading');
      assert(observations.kind === 'slax-controlled-visible-upgrade-reader-observations' && observations.observationsOnly === true && observations.nonce === request.nonce
        && observations.runId === request.runId && observations.device === device && observations.actualNativeResourceOwner === context.actualNativeResourceOwner, 'The actual reader observations do not belong to this run');
      const targetName = 'native-upgrade-offline-finished.json';
      assert(!exists(targetName), 'Never replace a completed offline visibility receipt');
      const receipt = {kind: 'slax-controlled-pre-reconnect-visible-finished', version: 1, phase: selectedPhase, platform, device, runId: owner.runId,
        nonce: request.nonce, requestedAt: request.requestedAt, capturedAt: Date.now(), visibleInputsSHA256: inputSHA256,
        visibilityRequestRaw: requestText, visibilityRequestMd5: createHash('md5').update(requestText).digest('hex'), offline, context, observations,
        visibleScreenshotsAndInputAcceptance: 'requires separately bound native XCTest/emulator evidence'};
      validatePreReconnectServiceBaseline({source, receipt, platform, runId: owner.runId, nativeDatabaseIdentity: offline.nativeDatabaseIdentity,
        originalSnapshot: context.currentInspection, currentLocalJson: context.currentLocalRows?.[0]?.data, md5String: value => createHash('md5').update(value).digest('hex')});
      const contents = JSON.stringify(receipt, null, 2) + '\n';
      if (platform === 'android') command('adb', ['-s', device, 'shell', `run-as com.slax.reader sh -c 'set -C; cat > files/${targetName}'`], contents);
      else writeFileSync(path.join(directory, targetName), contents, {flag: 'wx'});
    }
    if (platform === 'android') adb('shell', 'run-as', 'com.slax.reader', 'rm', `files/${name}`); else unlinkSync(regular(path.join(directory, name)));
  }
}
