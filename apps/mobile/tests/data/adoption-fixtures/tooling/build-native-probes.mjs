import {mkdtempSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const fixtureRoot = fileURLToPath(new URL('../', import.meta.url));
const platform = process.argv[2];
assert(['ios', 'android', 'host-identity'].includes(platform), 'Choose ios, android, or host-identity; this command only builds, never touches a device');
const output = mkdtempSync(path.join(tmpdir(), 'slax-native-owner-probe-'));
const run = (command, args) => {
  const result = spawnSync(command, args, {encoding: 'utf8'});
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
let executable;
if (platform === 'ios') {
  const sdk = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']);
  executable = path.join(output, 'SlaxOwnerProbe');
  run('xcrun', ['swiftc', '-sdk', sdk, '-target', 'arm64-apple-ios16.4-simulator', '-parse-as-library', path.join(fixtureRoot, 'native/OwnerProbe.swift'), '-o', executable]);
  run('codesign', ['--force', '--sign', '-', executable]);
} else if (platform === 'host-identity') {
  executable = path.join(output, 'SlaxIdentityHost');
  const production = fileURLToPath(new URL('../../../../modules/slax-legacy/ios/DatabaseIdentity.swift', import.meta.url));
  run('xcrun', ['swiftc', '-parse-as-library', production, path.join(fixtureRoot, 'host/IdentityMain.swift'), '-o', executable]);
  const report = JSON.parse(run(executable, []));
  assert.equal(report.status, 'passed');
  writeFileSync(path.join(output, 'host-report.json'), JSON.stringify(report, null, 2) + '\n');
} else {
  const sdk = process.env.ANDROID_HOME || path.join(homedir(), 'Library/Android/sdk');
  const buildTools = readdirSync(path.join(sdk, 'build-tools')).filter(name => /^\d+(?:\.\d+)*$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).at(-1);
  assert(buildTools, 'Android build tools are required');
  const classes = path.join(output, 'classes'); mkdirSync(classes);
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '';
  const java = name => javaBin ? path.join(javaBin, name) : name;
  run(java('javac'), ['--release', '8', '-d', classes, path.join(fixtureRoot, 'native/OwnerProbe.java')]);
  const jar = path.join(output, 'owner-probe.jar');
  run(java('jar'), ['cf', jar, '-C', classes, '.']);
  executable = path.join(output, 'owner-probe-dex.jar');
  run(path.join(sdk, 'build-tools', buildTools, 'd8'), ['--min-api', '26', '--output', executable, jar]);
}
const report = {kind: 'slax-controlled-native-owner-probe', version: 1, platform, output, executable, deviceExecuted: false};
writeFileSync(path.join(output, 'fixture-owner.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
