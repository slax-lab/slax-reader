import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, realpath, stat, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === '--project', 'Use --project with a marked isolated Share UI stage');
const project = await realpath(args[1]);
assert([await realpath('/tmp'), await realpath(os.tmpdir())].includes(path.dirname(project)) && /^slax-source-share-fixture-[a-z0-9-]+$/.test(path.basename(project)), 'A controlled temporary Share stage is required');
const marker = JSON.parse(await readFile(path.join(project, 'source-share-fixture.json'), 'utf8'));
assert(marker.controlledFixture === true && marker.fixtureVersion === 1 && marker.kind === 'original-swift-share-presentation' && marker.simulatorOnly === true && marker.bundleIdentifier === 'app.slax.reader.sourcesharefixture' && marker.extensionIdentifier === 'app.slax.reader.sourcesharefixture.share' && marker.sourceCheckoutModified === false && marker.originalSwiftByteIdentical === true && marker.originalKotlinRuntime === false && marker.realNetwork === false && marker.productionAppGroup === false, 'Invalid public Share fixture marker');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
for (const record of marker.files) {
  const relative = record.path;
  assert(typeof relative === 'string' && !path.isAbsolute(relative) && !relative.split('/').some(part => !part || part === '.' || part === '..') && !/(?:\.env|\.dev\.vars|credential|secret|private.?key|keystore|GoogleService|google-services)/i.test(relative), 'Forbidden public fixture input');
  const file = path.join(project, relative);
  assert(await realpath(file) === file && (await stat(file)).isFile(), 'Share inputs must be regular non-symlink files');
  assert(digest(await readFile(file)) === record.sha256, 'Prepared Share input changed');
}
function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  assert(result.status === 0, `${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
const build = path.join(project, 'build');
run('xcodebuild', ['-project', path.join(project, 'SourceShareFixture.xcodeproj'), '-scheme', 'SourceShareFixture', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', build, '-jobs', '1', 'build']);
const app = path.join(build, 'Build/Products/Debug-iphonesimulator/SourceShareHost.app');
const extension = path.join(app, 'PlugIns/SourceShareExtension.appex');
const framework = path.join(extension, 'Frameworks/ComposeApp.framework');
for (const bundle of [framework, extension, app]) run('codesign', ['--force', '--sign', '-', bundle]);
run('codesign', ['--verify', '--deep', '--strict', app]);
const report = {...marker, sourceNativeBuild: 'unchanged-Swift-controller-with-explicit-local-boundary-built',
  appPath: app, executableSHA256: digest(await readFile(path.join(app, 'SourceShareHost'))),
  extensionExecutableSHA256: digest(await readFile(path.join(extension, 'SourceShareExtension'))),
  boundaryExecutableSHA256: digest(await readFile(path.join(framework, 'ComposeApp'))),
  packagingDriverSHA256: digest(await readFile(new URL(import.meta.url))),
  signing: 'public-ad-hoc-simulator-only', simulatorInstall: 'not-performed-by-build-driver',
  nativeInteractionVerified: false, nativeVisualAcceptance: 'unverified'};
const reportPath = path.join(build, 'source-share-build-report.json');
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({appPath: app, reportPath, simulatorOnly: true, nativeVisualAcceptance: 'unverified'}));
