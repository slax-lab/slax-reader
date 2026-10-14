import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statfsSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkProductionEnvironment, checkProductionBundle} from './release-environment.mjs';
import {verifyFrameworkClosure} from './ios-frameworks.mjs';
import {applyMobileEnvironment} from './deploy-environment.cjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const MAIN = 'app.slax.reader', SHARE = 'app.slax.reader.share', GROUP = 'group.app.slax.reader';
const digest = value => createHash('sha256').update(value).digest('hex');

export function archiveResourceCheck(outputParent, readStatistics = statfsSync) {
  const requiredFreeBytes = 6n * 1024n ** 3n;
  const statistics = readStatistics(outputParent, {bigint: true});
  assert(typeof statistics.bsize === 'bigint' && statistics.bsize > 0n && typeof statistics.bavail === 'bigint' && statistics.bavail >= 0n, 'Archive free-space information is unavailable');
  const availableFreeBytes = statistics.bsize * statistics.bavail;
  assert(availableFreeBytes >= requiredFreeBytes, 'An iOS archive requires at least 6 GiB free on the output volume before starting Xcode');
  return {outputParent, availableFreeBytes: availableFreeBytes.toString(), requiredFreeBytes: requiredFreeBytes.toString()};
}

export function releaseInputs(environment) {
  checkProductionEnvironment(environment);
  assert(environment.EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE !== '1' && !environment.EXPO_PUBLIC_SLAX_UI_FIXTURE, 'A controlled fixture cannot become an iOS release');
  const version = environment.SLAX_MOBILE_VERSION, build = environment.SLAX_MOBILE_BUILD_NUMBER, previous = environment.SLAX_MOBILE_PREVIOUS_BUILD_NUMBER, team = environment.SLAX_APPLE_TEAM_ID;
  assert(/^\d+\.\d+\.\d+$/.test(version ?? '') && /^[1-9]\d*$/.test(build ?? '') && /^\d+$/.test(previous ?? ''), 'Provide the public release version/build and previous published build bound');
  assert(Number.isSafeInteger(Number(build)) && Number.isSafeInteger(Number(previous)) && Number(build) > Number(previous), 'The release build must exceed the previous published build bound');
  assert(/^[A-Z0-9]{10}$/.test(team ?? ''), 'Provide the public SLAX_APPLE_TEAM_ID for the existing Xcode account');
  return {version, build, previous, team};
}

export function parseReleaseArguments(args) {
  const command = args[0];
  assert(['archive', 'export', 'upload'].includes(command), 'Choose archive, export, or upload');
  const allowed = command === 'archive' ? ['--output'] : command === 'export' ? ['--archive', '--output'] : ['--archive', '--export'];
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    assert(allowed.includes(name) && !(name in options) && typeof value === 'string' && path.isAbsolute(value), 'Only explicit, unique absolute artifact paths are supported; Xcode flags cannot be forwarded');
    options[name] = value;
  }
  assert(allowed.every(name => options[name]), 'All artifact paths for this release command are required');
  return {command, options};
}

export function checkBundleMetadata(info, entitlements, signature, release, bundle, exported = false) {
  assert(info.CFBundleIdentifier === bundle && info.CFBundleShortVersionString === release.version && String(info.CFBundleVersion) === release.build, 'Application identity/version differs from the approved release inputs');
  assert(info.DTPlatformName === 'iphoneos' && info.CFBundleSupportedPlatforms?.includes('iPhoneOS') && !info.CFBundleSupportedPlatforms?.includes('iPhoneSimulator'), 'Only a real iPhoneOS artifact can be distributed');
  assert(signature.team === release.team && signature.appleAuthority === true && signature.adHoc === false, 'A verified Apple signing identity for the selected team is required');
  assert(entitlements['com.apple.developer.team-identifier'] === release.team && entitlements['application-identifier'] === `${release.team}.${bundle}`, 'Signed application entitlements differ from the selected team/bundle');
  assert(Array.isArray(entitlements['com.apple.security.application-groups']) && entitlements['com.apple.security.application-groups'].includes(GROUP), 'The original shared App Group entitlement is required');
  if (bundle === MAIN) assert(entitlements['com.apple.developer.applesignin']?.includes('Default'), 'The main app must retain Apple sign-in');
  if (bundle === SHARE) assert(info.NSExtension?.NSExtensionPointIdentifier === 'com.apple.share-services', 'The original share extension is required');
  if (exported) assert(entitlements['get-task-allow'] !== true, 'An App Store export cannot retain development debugging entitlement');
  checkFirebaseMetadata(info, bundle);
}

function firebaseRequirement(condition, detail) {
  assert(condition, `iOS release Firebase admission: ${detail}. Place the intended main-app registration at deploy/mobile/ios/GoogleService-Info.plist or supply SLAX_MOBILE_FIREBASE_IOS_CONFIG, regenerate with pnpm mobile -- prebuild --platform ios, then pnpm mobile -- pods. See deploy/mobile/README.md`);
}
function regularFile(filename) {
  try {return lstatSync(filename).isFile();} catch {return false;}
}
export function checkFirebaseBundleResources(directory) {
  firebaseRequirement(regularFile(path.join(directory, 'GoogleService-Info.plist')), 'main artifact is missing a regular bundled GoogleService-Info.plist; rebuild stale artifacts');
}
export function checkFirebaseMetadata(info, bundle) {
  if (bundle !== MAIN) return;
  firebaseRequirement(info.FirebaseDataCollectionDefaultEnabled !== false && info.FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED !== true && info.FIREBASE_ANALYTICS_COLLECTION_ENABLED !== false, `${bundle} metadata disables required Analytics collection`);
  firebaseRequirement(info.FirebaseAutomaticScreenReportingEnabled === false, 'main metadata must retain manual screen reporting');
  firebaseRequirement(info.FirebaseCrashlyticsCollectionEnabled !== false, 'main metadata disables required Crashlytics collection');
}
export function checkFirebaseArchiveAdmission(recorded, current) {
  firebaseRequirement(recorded?.version === 2 && current?.version === 2 && recorded.nativeSHA256 === current.nativeSHA256, 'archive lacks matching native Firebase admission evidence; create a fresh archive');
}
export function firebaseReleaseAdmission(iosRoot = path.join(appRoot, 'ios'), readPlist = plist) {
  firebaseRequirement(regularFile(path.join(iosRoot, 'SlaxReader/GoogleService-Info.plist')), 'SlaxReader is missing a regular generated GoogleService-Info.plist');
  const publicInputs = [];
  const text = relative => {
    firebaseRequirement(regularFile(path.join(iosRoot, relative)), `missing generated ${relative}`);
    const value = readFileSync(path.join(iosRoot, relative), 'utf8');
    publicInputs.push([relative, value]); return value;
  };
  const projectPath = 'SlaxReader.xcodeproj/project.pbxproj';
  text(projectPath);
  const project = readPlist(path.join(iosRoot, projectPath)), objects = project.objects ?? {};
  const root = objects[project.rootObject];
  const resolveReference = (id, visited = new Set()) => {
    const entry = objects[id];
    if (!entry || visited.has(id) || !['PBXFileReference', 'PBXGroup'].includes(entry.isa)) return undefined;
    visited.add(id);
    if (entry.sourceTree === 'SOURCE_ROOT') return entry.path;
    if (entry.sourceTree !== '<group>') return undefined;
    if (id === root?.mainGroup) return entry.path ?? '';
    const parents = Object.entries(objects).filter(([, value]) => value.isa === 'PBXGroup' && value.children?.includes(id));
    if (parents.length !== 1) return undefined;
    const parent = resolveReference(parents[0][0], visited);
    return parent === undefined ? undefined : path.posix.join(parent, entry.path ?? '');
  };
  const name = 'SlaxReader';
  const target = (root?.targets ?? []).map(id => objects[id]).find(value => value?.isa === 'PBXNativeTarget' && value.name === name);
  firebaseRequirement(target, `missing ${name} native target`);
  const phases = (target.buildPhases ?? []).map(id => objects[id]).filter(Boolean);
  const contains = (kind, relative) => phases.filter(phase => phase.isa === kind && String(phase.runOnlyForDeploymentPostprocessing) === '0').some(phase => (phase.files ?? []).some(id => resolveReference(objects[id]?.fileRef) === relative));
  firebaseRequirement(contains('PBXResourcesBuildPhase', `${name}/GoogleService-Info.plist`), `${name} Firebase resource is not in that target's Resources build phase`);
  firebaseRequirement(contains('PBXSourcesBuildPhase', `${name}/AppDelegate.swift`), `${name} Firebase bootstrap source is not in that target's Sources build phase`);
  const configurations = objects[target.buildConfigurationList]?.buildConfigurations ?? [];
  const release = configurations.map(id => objects[id]).find(value => value?.name === 'Release');
  const xcconfig = `Pods/Target Support Files/Pods-${name}/Pods-${name}.release.xcconfig`;
  firebaseRequirement(resolveReference(release?.baseConfigurationReference) === xcconfig, `${name} Release is not connected to its CocoaPods configuration`);
  const overrides = release.buildSettings?.OTHER_LDFLAGS;
  firebaseRequirement(overrides === undefined || (Array.isArray(overrides) ? overrides : overrides.split(/\s+/)).includes('$(inherited)'), `${name} Release drops inherited CocoaPods linker flags`);
  const linked = /^OTHER_LDFLAGS\s*=\s*(.*)$/m.exec(text(xcconfig))?.[1] ?? '';
  for (const framework of ['FirebaseCore', 'FirebaseAnalytics', 'FirebaseCrashlytics']) firebaseRequirement(linked.includes(`-framework "${framework}"`), `${name} Release does not link ${framework}`);
  const infoPath = `${name}/Info.plist`;
  firebaseRequirement(release.buildSettings?.INFOPLIST_FILE === infoPath, `${name} Release does not use the inspected public Info.plist`);
  text(infoPath);
  checkFirebaseMetadata(readPlist(path.join(iosRoot, infoPath)), MAIN);
  const main = text(`${name}/AppDelegate.swift`).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  firebaseRequirement(/^\s*import FirebaseCore\s*$/m.test(main) && /didFinishLaunchingWithOptions[\s\S]*?FirebaseApp\.configure\(\)\s*\n\s*factory\.startReactNative\(/.test(main), 'main AppDelegate lacks Firebase initialization before React Native startup');
  const crashPhase = phases.find(phase => phase.isa === 'PBXShellScriptBuildPhase' && phase.name === '[CP-User] [RNFB] Crashlytics Configuration');
  const crashScript = crashPhase?.shellScript?.replace(/^\s*#.*$/gm, '') ?? '';
  firebaseRequirement(String(crashPhase?.runOnlyForDeploymentPostprocessing) === '0' && /^\s*"\$\{PODS_ROOT\}\/FirebaseCrashlytics\/run"\s*$/m.test(crashScript) && crashPhase.inputPaths?.some(value => value.includes('DWARF_DSYM_FILE_NAME')), 'main target lacks the active Crashlytics symbol-upload phase');
  firebaseRequirement(regularFile(path.join(iosRoot, 'Pods/FirebaseCrashlytics/run')), 'CocoaPods Crashlytics symbol-upload script is missing');
  return {version: 2, nativeSHA256: digest(JSON.stringify(publicInputs))};
}

export function archiveArguments(release, directory) {
  return ['-workspace', 'SlaxReader.xcworkspace', '-scheme', 'SlaxReader', '-configuration', 'Release', '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS', '-archivePath', path.join(directory, 'SlaxReader.xcarchive'), '-derivedDataPath', path.join(directory, 'DerivedData'), '-jobs', '1', '-allowProvisioningUpdates', `DEVELOPMENT_TEAM=${release.team}`, 'CODE_SIGN_STYLE=Automatic', 'archive'];
}

export function exportOptions(release, destination) {
  assert(['export', 'upload'].includes(destination), 'Export and upload are separate commands');
  return {method: 'app-store-connect', destination, signingStyle: 'automatic', teamID: release.team, manageAppVersionAndBuildNumber: false, uploadSymbols: true};
}

function run(program, args, {cwd, input, inherit = false} = {}) {
  const result = spawnSync(program, args, {cwd, input, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', env: {...process.env, EXPO_NO_DOTENV: '1'}, maxBuffer: 4 * 1024 * 1024});
  assert(!result.error && result.status === 0, `${program} failed; the release stage was not completed`);
  return result;
}
const plist = filename => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', filename]).stdout);
function verifiedBundle(directory, release, bundle, exported) {
  assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(), 'Expected a regular signed bundle');
  const info = plist(path.join(directory, 'Info.plist'));
  checkProductionBundle(info, bundle === MAIN ? readFileSync(path.join(directory, 'main.jsbundle')) : undefined);
  assert(typeof info.CFBundleExecutable === 'string' && /^[a-zA-Z0-9_-]+$/.test(info.CFBundleExecutable), 'Expected a known bundle executable');
  const binary = path.join(directory, info.CFBundleExecutable);
  assert(lstatSync(binary).isFile() && !lstatSync(binary).isSymbolicLink(), 'Expected a regular native executable');
  run('codesign', ['--verify', '--deep', '--strict', directory]);
  const detail = run('codesign', ['--display', '--verbose=4', directory]);
  const signed = detail.stdout + detail.stderr;
  const signature = {team: /^TeamIdentifier=(.+)$/m.exec(signed)?.[1], appleAuthority: /^Authority=Apple (?:Development|Distribution):/m.test(signed) || /^Authority=iPhone (?:Developer|Distribution):/m.test(signed), adHoc: /^Signature=adhoc$/m.test(signed)};
  const entitlementOutput = run('codesign', ['--display', '--entitlements', ':-', directory]).stdout;
  const entitlements = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '--', '-'], {input: entitlementOutput}).stdout);
  checkBundleMetadata(info, entitlements, signature, release, bundle, exported);
  const loadCommands = run('xcrun', ['vtool', '-show-build', binary]).stdout;
  assert(/platform IOS\b/.test(loadCommands) && !/IOSSIMULATOR|MACCATALYST/.test(loadCommands), 'The signed binary must target iPhoneOS');
  return {bundle, version: release.version, build: release.build, binarySHA256: digest(readFileSync(binary)), team: signature.team, appGroup: GROUP, signatureVerified: true, platform: 'iphoneos'};
}
function verifyApplication(directory, release, exported = false) {
  verifyFrameworkClosure(directory);
  checkFirebaseBundleResources(directory);
  const main = verifiedBundle(directory, release, MAIN, exported);
  const extensions = readdirSync(path.join(directory, 'PlugIns')).filter(name => name.endsWith('.appex'));
  assert(extensions.length === 1 && extensions[0] === 'SlaxShare.appex', 'Exactly the original share extension must be embedded');
  const share = verifiedBundle(path.join(directory, 'PlugIns/SlaxShare.appex'), release, SHARE, exported);
  return {main, share};
}
function createOutput(value) {
  assert(!existsSync(value), 'Use a fresh output directory; existing release artifacts are never overwritten');
  const parent = realpathSync(path.dirname(value));
  const directory = path.join(parent, path.basename(value)); mkdirSync(directory);
  return directory;
}
function readArchive(value, release, firebaseAdmission) {
  const archive = realpathSync(value);
  assert(archive.endsWith('.xcarchive') && lstatSync(archive).isDirectory() && !lstatSync(value).isSymbolicLink(), 'Expected a real Xcode archive');
  const ownerPath = path.join(path.dirname(archive), 'ios-release-report.json');
  assert(lstatSync(ownerPath).isFile() && !lstatSync(ownerPath).isSymbolicLink(), 'Use an archive produced by this guarded release command');
  const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  assert(owner.kind === 'slax-ios-release' && owner.stage === 'archive' && owner.status === 'completed' && owner.archive === archive && owner.release.version === release.version && owner.release.build === release.build && owner.release.team === release.team, 'Archive report does not match these release inputs');
  checkFirebaseArchiveAdmission(owner.firebaseAdmission, firebaseAdmission);
  const application = path.join(archive, 'Products/Applications/SlaxReader.app');
  const verified = verifyApplication(application, release);
  assert(JSON.stringify(verified) === JSON.stringify(owner.verified), 'The archive changed after signature verification');
  return {archive, verified};
}
function verifyIpa(ipa, release) {
  assert(lstatSync(ipa).isFile() && !lstatSync(ipa).isSymbolicLink(), 'Expected one regular exported IPA');
  const entries = run('unzip', ['-Z1', ipa]).stdout.trim().split('\n');
  assert(entries.length && entries.every(entry => !entry.startsWith('/') && !entry.includes('\\') && !entry.split('/').includes('..')), 'Refuse an unsafe archive member path');
  const output = mkdtempSync(path.join(realpathSync(tmpdir()), 'slax-ios-release-inspection-'));
  try {
    run('ditto', ['-x', '-k', ipa, output]);
    const payload = path.join(output, 'Payload');
    assert(readdirSync(payload).length === 1 && readdirSync(payload)[0] === 'SlaxReader.app', 'The IPA must contain only the expected application');
    return {ipaSHA256: digest(readFileSync(ipa)), verified: verifyApplication(path.join(payload, 'SlaxReader.app'), release, true)};
  } finally {rmSync(output, {recursive: true, force: true});}
}
function saveReport(directory, report) {writeFileSync(path.join(directory, 'ios-release-report.json'), JSON.stringify(report, null, 2) + '\n');}
function optionsFile(directory, release, destination) {
  const filename = path.join(directory, `ExportOptions-${destination}.plist`);
  writeFileSync(filename, JSON.stringify(exportOptions(release, destination)));
  run('plutil', ['-convert', 'xml1', filename]); return filename;
}

export function executeRelease(args, environment = process.env, iosRoot = path.join(appRoot, 'ios')) {
  assert(process.platform === 'darwin', 'The iOS release workflow requires Xcode on macOS');
  const {command, options} = parseReleaseArguments(args), release = releaseInputs(environment);
  const firebaseAdmission = firebaseReleaseAdmission(iosRoot);
  const sourceInfo = plist(path.join(iosRoot, 'SlaxReader/Info.plist'));
  checkProductionBundle(sourceInfo);
  checkProductionBundle(plist(path.join(iosRoot, 'SlaxShare/Info.plist')));
  assert(sourceInfo.CFBundleShortVersionString === release.version && String(sourceInfo.CFBundleVersion) === release.build, 'Regenerate native projects with the same version inputs before archiving');
  if (command === 'archive') {
    const resources = archiveResourceCheck(realpathSync(path.dirname(options['--output'])));
    const directory = createOutput(options['--output']), archive = path.join(directory, 'SlaxReader.xcarchive');
    const report = {kind: 'slax-ios-release', version: 1, stage: command, status: 'started', release, archive, resources, firebaseAdmission, testFlightUploadAttempted: false}; saveReport(directory, report);
    run('xcodebuild', archiveArguments(release, directory), {cwd: iosRoot, inherit: true});
    const verified = verifyApplication(path.join(archive, 'Products/Applications/SlaxReader.app'), release);
    saveReport(directory, {...report, status: 'completed', verified, completedAt: new Date().toISOString()});
    console.log(JSON.stringify({stage: command, archive, signedIPhoneOS: true, testFlightUploaded: false})); return;
  }
  const {archive, verified: archiveVerification} = readArchive(options['--archive'], release, firebaseAdmission);
  if (command === 'export') {
    const directory = createOutput(options['--output']);
    const report = {kind: 'slax-ios-release', version: 1, stage: command, status: 'started', release, archive, archiveVerification, testFlightUploadAttempted: false}; saveReport(directory, report);
    run('xcodebuild', ['-exportArchive', '-archivePath', archive, '-exportPath', directory, '-exportOptionsPlist', optionsFile(directory, release, 'export'), '-allowProvisioningUpdates'], {inherit: true});
    const ipas = readdirSync(directory).filter(name => name.endsWith('.ipa')); assert(ipas.length === 1, 'Expected exactly one exported IPA');
    const ipa = path.join(directory, ipas[0]), exported = verifyIpa(ipa, release);
    saveReport(directory, {...report, status: 'completed', ipa, ...exported, completedAt: new Date().toISOString()});
    console.log(JSON.stringify({stage: command, ipa, signedIPhoneOS: true, testFlightUploaded: false})); return;
  }
  const directory = realpathSync(options['--export']), reportPath = path.join(directory, 'ios-release-report.json');
  assert(lstatSync(reportPath).isFile() && !lstatSync(reportPath).isSymbolicLink(), 'A completed verified export is required before upload');
  const exported = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert(exported.kind === 'slax-ios-release' && exported.stage === 'export' && exported.status === 'completed' && exported.archive === archive && JSON.stringify(exported.archiveVerification) === JSON.stringify(archiveVerification) && exported.release.team === release.team && exported.release.version === release.version && exported.release.build === release.build, 'The export does not belong to this exact archive/release');
  assert(path.dirname(exported.ipa) === directory && digest(readFileSync(exported.ipa)) === exported.ipaSHA256, 'The verified IPA changed before upload');
  const current = verifyIpa(exported.ipa, release); assert(JSON.stringify(current.verified) === JSON.stringify(exported.verified), 'The exported signatures changed before upload');
  const uploadDirectory = path.join(directory, `upload-${randomUUID()}`); mkdirSync(uploadDirectory);
  const report = {kind: 'slax-ios-release', version: 1, stage: command, status: 'started', release, archive, exportedIpa: exported.ipa, exportedIpaSHA256: exported.ipaSHA256, testFlightUploadAttempted: true, testFlightProcessingConfirmed: false}; saveReport(uploadDirectory, report);
  try {
    run('xcodebuild', ['-exportArchive', '-archivePath', archive, '-exportPath', uploadDirectory, '-exportOptionsPlist', optionsFile(uploadDirectory, release, 'upload'), '-allowProvisioningUpdates'], {inherit: true});
    saveReport(uploadDirectory, {...report, status: 'xcode-upload-command-succeeded', completedAt: new Date().toISOString()});
    console.log(JSON.stringify({stage: command, status: 'xcode-upload-command-succeeded', report: path.join(uploadDirectory, 'ios-release-report.json'), testFlightProcessingConfirmed: false}));
  } catch (error) {saveReport(uploadDirectory, {...report, status: 'failed', completedAt: new Date().toISOString()}); throw error;}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applyMobileEnvironment();
  executeRelease(process.argv.slice(2));
}
