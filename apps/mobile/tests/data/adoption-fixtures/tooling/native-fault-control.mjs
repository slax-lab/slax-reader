import assert from 'node:assert/strict';
import {existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateCompletedServicePrerequisite} from '../../completed-native-service.ts';

const servicePhases = ['service-reconnect', 'service-first-upgrade', 'hold-service-first-upgrade', 'resume-service-first-upgrade'];
const firstPhases = ['hold-before-first-sdk-open', 'resume-first-sdk-open', ...servicePhases.slice(1)];
const phases = [...firstPhases, 'hold-before-sdk-open', 'resume-before-sdk-open', 'hold-after-offline-commit', 'resume-after-offline-commit', 'hold-owner', 'repeat-accepted', 'service-reconnect'];
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert(['--platform', '--device', '--phase', '--run-id', '--service-directory', '--probe', '--status', '--kill'].includes(key), `Unknown argument: ${key}`);
  options[key.slice(2)] = ['--status', '--kill'].includes(key) ? true : process.argv[++i];
}
const platform = options.platform, device = options.device;
assert(['ios', 'android'].includes(platform), 'Choose ios or android');
assert(platform === 'ios' ? /^[0-9a-f-]{36}$/i.test(device || '') : /^emulator-\d+$/.test(device || ''), 'Only an explicitly identified controlled simulator/emulator is accepted');
assert(!options.phase || phases.includes(options.phase), 'Unrecognized synthetic fault phase');
const command = (name, args, input) => {
  const result = spawnSync(name, args, {encoding: 'utf8', input, maxBuffer: 1024 * 1024, timeout: 30000});
  assert.equal(result.status, 0, `${name} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
const adb = (...args) => command('adb', ['-s', device, ...args]);
let directory;
if (platform === 'ios') {
  const container = command('xcrun', ['simctl', 'get_app_container', device, 'app.slax.reader', 'data']);
  const canonical = realpathSync(container);
  assert(canonical === container && canonical.includes(`/CoreSimulator/Devices/${device}/data/Containers/Data/Application/`), 'The application container is outside the requested controlled simulator');
  directory = path.join(canonical, 'Library/Application Support');
}
const read = name => {
  assert(/^[a-z-]+\.json$/.test(name), 'Only named synthetic fixture reports may be read');
  if (platform === 'android') return JSON.parse(adb('shell', 'run-as', 'com.slax.reader', 'cat', `files/${name}`));
  const file = path.join(directory, name);
  assert(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'The synthetic control file is not a regular file');
  return JSON.parse(readFileSync(file, 'utf8'));
};
const source = read('legacy-fixture-report.json');
assert(source.controlledFixture === true && source.fixtureVersion === 1 && source.producer === 'powersync-kotlin-1.14.1' && source.coreVersion?.startsWith('0.5.1/'), 'The original controlled fixture marker is missing');
assert(source.transactions?.length === 2 && source.transactions.flatMap(value => value.crud).map(value => value.id).join(',') === 'tag-1,bookmark-1,bookmark-1,comment-1', 'Unexpected synthetic original operations');
assert(platform === 'ios' ? source.iosBundleId === 'app.slax.reader' && source.nativePlatform === 'ios-simulator' : source.androidBundleId === 'com.slax.reader', 'Another application owns this marker');
const selectedPhase = options.phase || read('native-adoption-fault-request.json').phase;
if (!firstPhases.includes(selectedPhase)) {
  let successful;
  try {successful = read('native-adoption-report.json');} catch {}
  if (successful !== undefined) {
    assert(successful.status === 'passed' && successful.platform === platform && successful.sameIdentityReplacement === true && successful.coreVersion?.startsWith('0.5.3/'), 'A successful genuine native upgrade is required first');
  } else validateCompletedServicePrerequisite(read('native-service-report.json'), platform, selectedPhase, options['run-id'] || read('native-adoption-fault-request.json').runId);
}

if (options.phase) {
  assert(/^[a-zA-Z0-9-]{1,64}$/.test(options['run-id'] || ''), 'An explicit bounded synthetic run ID is required');
  const request = {kind: 'slax-native-adoption-fault-request', version: 1, runId: options['run-id'], phase: options.phase, requestedAt: Date.now(), originalDatabasePath: source.databasePath};
  if (servicePhases.includes(options.phase)) {
    assert(typeof options['service-directory'] === 'string', 'An explicitly owned real-service fixture directory is required');
    const controlled = realpathSync(options['service-directory']);
    assert(path.dirname(controlled) === realpathSync(tmpdir()) && /^slax-native-real-service-[a-zA-Z0-9]+$/.test(path.basename(controlled)), 'Use only this task\'s controlled real service');
    const ownerFile = path.join(controlled, 'service-owner.json');
    assert(lstatSync(ownerFile).isFile() && !lstatSync(ownerFile).isSymbolicLink(), 'A regular controlled service marker is required');
    const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
    assert(owner.kind === 'slax-controlled-native-real-service' && owner.runId === request.runId && owner.privateKeyPersisted === false && owner.tokensPersisted === false, 'Controlled service identity mismatch');
    for (const name of ['apiOrigin', 'syncOrigin']) {
      const url = new URL(owner[name]);
      assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) > 1024 && url.origin === owner[name], 'Only the owned service\'s loopback origin is accepted');
      request[name] = owner[name];
    }
    assert(request.apiOrigin !== request.syncOrigin, 'Independent API and synchronization ports are required');
    if (platform === 'android') {
      const mappings = adb('reverse', '--list').split('\n').map(line => line.trim().split(/\s+/));
      const created = [];
      for (const origin of [request.apiOrigin, request.syncOrigin]) {
        const port = `tcp:${new URL(origin).port}`, existing = mappings.find(parts => parts[1] === port);
        assert(!existing || existing[2] === port, 'Refuse to replace another emulator reverse mapping');
        if (!existing) {adb('reverse', port, port); created.push({device, source: port, destination: port});}
      }
      owner.reverseMappings = [...(owner.reverseMappings ?? []), ...created];
      writeFileSync(ownerFile, JSON.stringify(owner, null, 2) + '\n');
    }
  } else assert(options['service-directory'] === undefined, 'Service origins apply only to an explicit real-service phase');
  const name = 'native-adoption-fault-request.json', contents = JSON.stringify(request, null, 2) + '\n';
  if (platform === 'android') command('adb', ['-s', device, 'shell', "run-as com.slax.reader sh -c 'cat > files/native-adoption-fault-request.json'"], contents);
  else {
    const target = path.join(directory, name);
    assert(!existsSync(target) || !lstatSync(target).isSymbolicLink(), 'Refuse a symlink control file');
    writeFileSync(target, contents);
  }
  console.log(JSON.stringify({kind: 'slax-native-fault-control', requestWritten: true, platform, device, phase: request.phase, runId: request.runId}));
}
if (options.status || options.kill) {
  const state = read('native-adoption-fault-state.json'), request = read('native-adoption-fault-request.json');
  assert(state.kind === 'slax-native-adoption-fault-state' && state.version === 1 && state.runId === request.runId && state.phase === request.phase && state.requestedAt === request.requestedAt && state.writtenAt >= request.requestedAt, 'The live synthetic phase does not match its fresh request');
  console.log(JSON.stringify({kind: state.kind, platform, device, runId: state.runId, phase: state.phase, readyForExternalKill: state.readyForExternalKill, pendingOperations: state.baseline.pendingOperations, queueDigest: state.baseline.queueDigest}));
  if (options.kill) {
    assert(state.readyForExternalKill === true && state.phase.startsWith('hold-'), 'SIGKILL requires an explicitly waiting controlled fault phase');
    if (platform === 'ios') {
      const bundle = command('xcrun', ['simctl', 'get_app_container', device, 'app.slax.reader', 'app']);
      const name = command('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(bundle, 'Info.plist')]);
      assert(name === 'SlaxReader', 'The controlled Expo executable is required');
      const processes = command('ps', ['-axo', 'pid=,comm=']).split('\n').flatMap(line => {
        const match = /^\s*(\d+)\s+(.+)$/.exec(line);
        return match && match[2] === path.join(bundle, name) ? [Number(match[1])] : [];
      });
      assert(processes.length === 1, 'Only one already-running exact controlled Expo process may be signaled');
      const pid = processes[0];
      const executable = command('ps', ['-p', String(pid), '-o', 'comm=']);
      assert(executable.includes(`/CoreSimulator/Devices/${device}/data/Containers/Bundle/Application/`) && /\.app\/SlaxReader$/.test(executable), 'Refuse to signal a process outside the controlled installed Expo bundle');
      process.kill(pid, 'SIGKILL');
      console.log(JSON.stringify({kind: 'slax-native-fault-kill', platform, device, pid, signal: 'SIGKILL'}));
    } else {
      const pid = adb('shell', 'pidof', 'com.slax.reader');
      assert(/^\d+$/.test(pid) && Number(pid) > 1, 'Only one exact controlled main app process may be signaled');
      assert(adb('shell', 'run-as', 'com.slax.reader', 'cat', `/proc/${pid}/cmdline`).replace(/\0/g, '') === 'com.slax.reader', 'The controlled process changed identity');
      adb('shell', 'run-as', 'com.slax.reader', 'kill', '-9', pid);
      console.log(JSON.stringify({kind: 'slax-native-fault-kill', platform, device, pid: Number(pid), signal: 'SIGKILL'}));
    }
  }
}
if (options.probe) {
  const executable = realpathSync(options.probe), output = path.dirname(executable);
  assert(path.dirname(output) === realpathSync(tmpdir()) && /^slax-native-owner-probe-[a-zA-Z0-9]+$/.test(path.basename(output)), 'Use only this task\'s newly generated public probe');
  const owner = JSON.parse(readFileSync(path.join(output, 'fixture-owner.json'), 'utf8'));
  assert(owner.kind === 'slax-controlled-native-owner-probe' && owner.platform === platform && realpathSync(owner.executable) === executable, 'Probe ownership marker mismatch');
  if (platform === 'ios') {
    const sharedRoot = directory.slice(0, directory.indexOf('/data/Containers/Data/Application/')) + '/data/Containers/Shared/AppGroup';
    const groups = readdirSync(sharedRoot).filter(name => /^[0-9A-F-]{36}$/i.test(name)).flatMap(name => {
      const root = path.join(sharedRoot, name), metadata = path.join(root, '.com.apple.mobile_container_manager.metadata.plist');
      if (!existsSync(metadata)) return [];
      const identifier = command('plutil', ['-extract', 'MCMMetadataIdentifier', 'raw', '-o', '-', metadata]);
      return identifier === 'group.app.slax.reader' ? [root] : [];
    });
    assert(groups.length === 1, 'The controlled application group is missing or ambiguous');
    console.log(command('xcrun', ['simctl', 'spawn', device, executable, device, path.join(groups[0], '.slax-data-owner.lock')]));
  } else {
    const remote = '/data/local/tmp/slax-controlled-owner-probe.jar';
    adb('push', executable, remote);
    // Android 14 rejects writable DEX, including shell-owned probe archives.
    adb('shell', 'chmod', '0444', remote);
    console.log(adb('shell', `run-as com.slax.reader sh -c 'CLASSPATH=${remote} app_process /system/bin slax.fixture.OwnerProbe /data/user/0/com.slax.reader/files/.slax-data-owner.lock'`));
  }
}
