import assert from 'node:assert/strict';
import {existsSync, lstatSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const options = {};
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  assert(['--platform', '--device', '--probe', '--mode', '--request', '--execute', '--status', '--cleanup'].includes(key), 'Unknown controlled preference argument');
  options[key.slice(2)] = ['--request', '--execute', '--status', '--cleanup'].includes(key) ? true : process.argv[++index];
}
const platform = options.platform, device = options.device;
assert(['ios', 'android'].includes(platform));
assert(platform === 'ios' ? /^[0-9A-Fa-f-]{36}$/.test(device || '') : /^emulator-\d+$/.test(device || ''), 'Only an explicit controlled simulator/emulator is allowed');
assert(['request', 'execute', 'status', 'cleanup'].filter(key => options[key]).length === 1, 'Select one controlled preference action');
const command = (name, args, input) => {
  const result = spawnSync(name, args, {encoding: 'utf8', input, timeout: 30000, maxBuffer: 1024 * 1024});
  assert.equal(result.status, 0, `${name} controlled command failed: ${result.stderr || result.stdout}`); return result.stdout.trim();
};
const adb = (...args) => command('adb', ['-s', device, ...args]);
let directory;
if (platform === 'ios') {
  const data = command('xcrun', ['simctl', 'get_app_container', device, 'app.slax.reader', 'data']);
  assert(realpathSync(data) === data && data.includes(`/CoreSimulator/Devices/${device}/data/Containers/Data/Application/`));
  directory = path.join(data, 'Library/Application Support');
}
const read = name => {
  assert(/^[a-z-]+\.json$/.test(name));
  if (platform === 'android') {
    adb('shell', 'run-as', 'com.slax.reader', 'test', '-f', `files/${name}`);
    const resolved = adb('shell', 'run-as', 'com.slax.reader', 'readlink', '-f', `files/${name}`);
    assert(['/data/data/com.slax.reader/files/', '/data/user/0/com.slax.reader/files/'].some(prefix => resolved === prefix + name), 'Refuse another sandbox or symlink target');
    return JSON.parse(adb('shell', 'run-as', 'com.slax.reader', 'cat', `files/${name}`));
  }
  const file = path.join(directory, name); assert(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink()); return JSON.parse(readFileSync(file, 'utf8'));
};
const source = read('legacy-fixture-report.json'), service = read('native-service-report.json');
assert(source.controlledFixture === true && source.fixtureVersion === 1 && source.producer === 'powersync-kotlin-1.14.1' && source.coreVersion?.startsWith('0.5.1/') && source.transactions?.flatMap(value => value.crud).map(value => value.id).join(',') === 'tag-1,bookmark-1,bookmark-1,comment-1', 'A genuine controlled old producer is required');
assert(platform === 'android' ? source.androidBundleId === 'com.slax.reader' : source.iosBundleId === 'app.slax.reader' && source.nativePlatform === 'ios-simulator');
assert(service.status === 'passed' && service.platform === platform && typeof service.runId === 'string' && service.runId.length > 0 && service.coreVersion === '0.5.3/2ba6b280' && service.originalLegacyFirstQueueUpload === true && service.originalQueueOperations === 4 && service.pendingOperations === 0 && service.productionAdoptionEnabled === false && service.credentialsPersisted === false && service.exactServerSqlReceipts?.flat().length === 6, 'A completed controlled original-service upgrade is required');
assert.deepEqual(service.realNativeSdkCompletions, [{transactionId: 1, clientIds: [1, 2]}, {transactionId: 2, clientIds: [3, 4]}, {transactionId: 3, clientIds: [5, 6]}]);
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
let probe, owner, ownerFile;
if (options.request || options.execute) {
  assert(typeof options.probe === 'string', 'Choose the newly built public preference probe');
  probe = realpathSync(options.probe); const output = path.dirname(probe);
  assert(path.dirname(output) === realpathSync(tmpdir()) && /^slax-native-preference-probe-[a-zA-Z0-9]+$/.test(path.basename(output)));
  ownerFile = path.join(output, 'fixture-owner.json'); assert(lstatSync(ownerFile).isFile() && !lstatSync(ownerFile).isSymbolicLink()); owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
  const moduleRoot = fileURLToPath(new URL('../../../../modules/slax-legacy/', import.meta.url));
  const sourcePath = path.join(moduleRoot, platform === 'android' ? 'android/src/main/java/com/slax/reader/legacy/SlaxLegacyModule.kt' : 'ios/SlaxLegacyModule.swift');
  const templatePath = fileURLToPath(new URL(`../native/PreferenceProbe.template.${platform === 'android' ? 'kt' : 'swift'}`, import.meta.url));
  assert(owner.kind === 'slax-controlled-native-preference-probe' && owner.version === 1 && owner.platform === platform && realpathSync(owner.executable) === probe && owner.executableSHA256 === hash(probe) && owner.sourcePath === sourcePath && owner.sourceSHA256 === hash(sourcePath) && owner.templatePath === templatePath && owner.templateSHA256 === hash(templatePath) && owner.productionBodiesModified === false, 'The probe differs from its immutable current native source/template');
}
const requestName = 'native-preference-cas-request.json';
if (options.request) {
  assert(['stale-cas', 'lock-read'].includes(options.mode), 'Choose stale-cas or lock-read');
  const request = {kind: 'slax-native-preference-cas-request', version: 1, platform, device, nonce: randomUUID(), requestedAt: Date.now(), mode: options.mode, sourceSHA256: owner.sourceSHA256, serviceRunId: service.runId};
  const contents = JSON.stringify(request, null, 2) + '\n';
  if (platform === 'android') command('adb', ['-s', device, 'shell', "run-as com.slax.reader sh -c 'cat > files/native-preference-cas-request.json'"], contents);
  else {
    const target = path.join(directory, requestName); assert(!existsSync(target) || !lstatSync(target).isSymbolicLink()); writeFileSync(target, contents);
  }
  console.log(JSON.stringify({kind: request.kind, action: 'request-written', platform, device, nonce: request.nonce, mode: request.mode}));
} else {
  const request = read(requestName);
  assert(request.kind === 'slax-native-preference-cas-request' && request.version === 1 && request.platform === platform && request.device === device && /^[0-9a-f-]{36}$/.test(request.nonce) && request.serviceRunId === service.runId && ['stale-cas', 'lock-read'].includes(request.mode));
  if (options.execute) {
    assert(request.sourceSHA256 === owner.sourceSHA256);
    const state = read('native-preference-cas-state.json');
    assert(state.kind === 'slax-native-preference-cas-state' && state.nonce === request.nonce && state.requestedAt === request.requestedAt && state.phase === 'waiting-probe', 'The main actual native bridge has not captured this fresh revision');
    if (platform === 'android') {
      const remote = '/data/local/tmp/slax-controlled-preference-probe.jar';
      const existing = spawnSync('adb', ['-s', device, 'shell', 'test', '-e', remote], {encoding: 'utf8', timeout: 5000});
      if (existing.status === 0) assert(adb('shell', 'sha256sum', remote).split(/\s/)[0] === owner.executableSHA256, 'Refuse another probe at the fixed remote path');
      else {assert(existing.status === 1); adb('push', probe, remote); adb('shell', 'chmod', '0444', remote);}
      console.log(adb('shell', `run-as com.slax.reader sh -c 'CLASSPATH=${remote} app_process /system/bin slax.fixture.PreferenceProbe ${device} /data/data/com.slax.reader/files'`));
    } else {
      const sharedRoot = directory.slice(0, directory.indexOf('/data/Containers/Data/Application/')) + '/data/Containers/Shared/AppGroup';
      const groups = readdirSync(sharedRoot).filter(name => /^[0-9A-Fa-f-]{36}$/.test(name)).filter(name => {
        const metadata = path.join(sharedRoot, name, '.com.apple.mobile_container_manager.metadata.plist');
        return existsSync(metadata) && command('plutil', ['-extract', 'MCMMetadataIdentifier', 'raw', '-o', '-', metadata]) === 'group.app.slax.reader';
      });
      assert(groups.length === 1, 'The exact controlled application group is ambiguous');
      console.log(command('xcrun', ['simctl', 'spawn', device, probe, device, directory, path.join(sharedRoot, groups[0])]));
    }
  } else {
    const report = read('native-preference-cas-report.json');
    assert(report.kind === 'slax-native-preference-cas-report' && report.status === 'passed' && report.nonce === request.nonce && report.mode === request.mode && report.device === device && report.requestedAt === request.requestedAt && report.productionAdoptionProfileUsed === false, 'The matching native preference result has not passed');
    console.log(JSON.stringify(report));
    if (options.cleanup) {
      if (platform === 'android') adb('shell', 'run-as', 'com.slax.reader', 'rm', `files/${requestName}`);
      else unlinkSync(path.join(directory, requestName));
      console.log(JSON.stringify({kind: 'slax-native-preference-cas-cleanup', removedMatchingRequestOnly: true, preferenceStoreAndReportsRetained: true}));
    }
  }
}
