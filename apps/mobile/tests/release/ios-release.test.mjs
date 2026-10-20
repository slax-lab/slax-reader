import assert from 'node:assert/strict';
import test from 'node:test';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {archiveArguments, archiveResourceCheck, checkBundleMetadata, checkFirebaseArchiveAdmission, checkFirebaseBundleResources, executeRelease, exportOptions, firebaseReleaseAdmission, parseReleaseArguments, releaseInputs} from '../../tooling/ios-release.mjs';

const environment = {SLAX_APPLE_TEAM_ID: '8G3A932HJG'};
const release = releaseInputs(environment);
const mainInfo = {CFBundleIdentifier: 'app.slax.reader', CFBundleShortVersionString: release.version, CFBundleVersion: release.build, DTPlatformName: 'iphoneos', CFBundleSupportedPlatforms: ['iPhoneOS'], FirebaseAutomaticScreenReportingEnabled: false};
const entitlement = {'application-identifier': '8G3A932HJG.app.slax.reader', 'com.apple.developer.team-identifier': '8G3A932HJG', 'com.apple.security.application-groups': ['group.app.slax.reader'], 'com.apple.developer.applesignin': ['Default']};
const signature = {team: '8G3A932HJG', appleAuthority: true, adHoc: false};

test('iOS admission uses package metadata even when obsolete version environment variables are present', () => {
  const manifest = {version: '1.2.3', buildNumber: 12, previousBuildNumber: 11};
  assert.deepEqual(releaseInputs({...environment, SLAX_MOBILE_VERSION: '9.9.9', SLAX_MOBILE_BUILD_NUMBER: '999', SLAX_MOBILE_PREVIOUS_BUILD_NUMBER: '998'}, manifest), {version: '1.2.3', build: '12', previous: '11', team: environment.SLAX_APPLE_TEAM_ID});
});

function firebaseFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-release-public-fixture-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const write = (relative, value) => {const filename = path.join(root, relative); mkdirSync(path.dirname(filename), {recursive: true}); writeFileSync(filename, value);};
  const objects = {project: {isa: 'PBXProject', mainGroup: 'root', targets: ['SlaxReader', 'SlaxShare']}, root: {isa: 'PBXGroup', sourceTree: '<group>', children: []}};
  for (const [name, source, frameworks] of [['SlaxReader', 'AppDelegate.swift', ['FirebaseCore', 'FirebaseAnalytics', 'FirebaseCrashlytics']]]) {
    objects[name] = {isa: 'PBXNativeTarget', name, buildPhases: [`${name}Resources`, `${name}Sources`], buildConfigurationList: `${name}Configurations`};
    objects[`${name}Configurations`] = {isa: 'XCConfigurationList', buildConfigurations: [`${name}Release`]};
    objects[`${name}Release`] = {isa: 'XCBuildConfiguration', name: 'Release', baseConfigurationReference: `${name}xcconfig`, buildSettings: {INFOPLIST_FILE: `${name}/Info.plist`, OTHER_LDFLAGS: ['$(inherited)', '-ObjC']}};
    const xcconfig = `Pods/Target Support Files/Pods-${name}/Pods-${name}.release.xcconfig`;
    for (const [key, relative] of [['config', `${name}/GoogleService-Info.plist`], ['source', `${name}/${source}`], ['xcconfig', xcconfig]]) {
      objects[`${name}${key}`] = {isa: 'PBXFileReference', sourceTree: '<group>', path: relative};
      objects.root.children.push(`${name}${key}`);
    }
    for (const [kind, key] of [['Resources', 'config'], ['Sources', 'source']]) {
      objects[`${name}${kind}`] = {isa: `PBX${kind}BuildPhase`, runOnlyForDeploymentPostprocessing: '0', files: [`${name}${key}Build`]};
      objects[`${name}${key}Build`] = {isa: 'PBXBuildFile', fileRef: `${name}${key}`};
    }
    write(`${name}/GoogleService-Info.plist`, '');
    chmodSync(path.join(root, name, 'GoogleService-Info.plist'), 0);
    write(`${name}/Info.plist`, JSON.stringify(name === 'SlaxReader' ? mainInfo : {}));
    write(xcconfig, `OTHER_LDFLAGS = $(inherited) ${frameworks.map(name => `-framework "${name}"`).join(' ')}\n`);
  }
  objects.SlaxShare = {isa: 'PBXNativeTarget', name: 'SlaxShare', buildPhases: [], buildConfigurationList: 'SlaxShareConfigurations'};
  objects.SlaxShareConfigurations = {isa: 'XCConfigurationList', buildConfigurations: ['SlaxShareRelease']};
  objects.SlaxShareRelease = {isa: 'XCBuildConfiguration', name: 'Release', buildSettings: {PRODUCT_BUNDLE_IDENTIFIER: 'app.slax.reader.share', INFOPLIST_FILE: 'SlaxShare/Info.plist'}};
  objects.SlaxReader.buildPhases.push('crash');
  objects.crash = {isa: 'PBXShellScriptBuildPhase', name: '[CP-User] [RNFB] Crashlytics Configuration', runOnlyForDeploymentPostprocessing: '0', shellScript: '"${PODS_ROOT}/FirebaseCrashlytics/run"\n', inputPaths: ['${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${TARGET_NAME}']};
  const project = {rootObject: 'project', objects};
  const saveProject = () => write('SlaxReader.xcodeproj/project.pbxproj', JSON.stringify(project));
  saveProject();
  write('SlaxReader/AppDelegate.swift', 'import FirebaseCore\nfunc application(didFinishLaunchingWithOptions: Any) {\nFirebaseApp.configure()\nfactory.startReactNative()\n}\n');
  write('SlaxShare/ShareCollector.swift', 'import Foundation\nenum ShareCollector {}\n');
  write('Pods/FirebaseCrashlytics/run', '');
  const readPublicPlist = filename => {
    assert(['project.pbxproj', 'Info.plist'].includes(path.basename(filename)), 'Never parse a Firebase configuration');
    assert(!filename.includes('SlaxShare'), 'Firebase admission must not inspect Share metadata');
    return JSON.parse(readFileSync(filename, 'utf8'));
  };
  return {root, objects, write, saveProject, admit: () => firebaseReleaseAdmission(root, readPublicPlist)};
}

test('Firebase admission uses the real macOS plist converter on public fixture project metadata', {skip: process.platform !== 'darwin'}, t => {
  const fixture = firebaseFixture(t);
  assert.deepEqual(firebaseReleaseAdmission(fixture.root), fixture.admit());
});

test('Firebase admission resolves main group paths and rejects wrong-target resources', t => {
  const fixture = firebaseFixture(t), id = 'SlaxReaderconfig';
  fixture.objects.root.children = fixture.objects.root.children.filter(value => value !== id);
  fixture.objects.root.children.push('SlaxReadergroup');
  fixture.objects.SlaxReadergroup = {isa: 'PBXGroup', sourceTree: '<group>', path: 'SlaxReader', children: [id]};
  fixture.objects[id].path = 'GoogleService-Info.plist';
  fixture.saveProject();
  fixture.admit();
  fixture.objects.SlaxReadergroup.path = 'SlaxShare';
  fixture.saveProject();
  assert.throws(fixture.admit, /SlaxReader.*Resources build phase/);
});

test('Firebase admission rejects an unattached main Release configuration and missing upload executable', t => {
  const fixture = firebaseFixture(t);
  fixture.objects.SlaxReaderRelease.baseConfigurationReference = 'SlaxSharexcconfig';
  fixture.saveProject();
  assert.throws(fixture.admit, /SlaxReader Release is not connected/);
  fixture.objects.SlaxReaderRelease.baseConfigurationReference = 'SlaxReaderxcconfig';
  fixture.objects.SlaxReaderRelease.buildSettings.OTHER_LDFLAGS = '-ObjC';
  fixture.saveProject();
  assert.throws(fixture.admit, /drops inherited CocoaPods linker flags/);
  fixture.objects.SlaxReaderRelease.buildSettings.OTHER_LDFLAGS = '$(inherited) -ObjC';
  fixture.objects.SlaxReaderRelease.buildSettings.INFOPLIST_FILE = 'SlaxShare/Info.plist';
  fixture.saveProject();
  assert.throws(fixture.admit, /does not use the inspected public Info.plist/);
  fixture.objects.SlaxReaderRelease.buildSettings.INFOPLIST_FILE = 'SlaxReader/Info.plist';
  fixture.saveProject();
  rmSync(path.join(fixture.root, 'Pods/FirebaseCrashlytics/run'));
  assert.throws(fixture.admit, /symbol-upload script is missing/);
});

test('Firebase release admission checks only public main integration without opening configuration contents', t => {
  const fixture = firebaseFixture(t);
  const admission = fixture.admit();
  assert.equal(admission.version, 2);
  assert.match(admission.nativeSHA256, /^[a-f0-9]{64}$/);
  assert.deepEqual(fixture.admit(), admission);
  assert.equal(existsSync(path.join(fixture.root, 'SlaxShare/GoogleService-Info.plist')), false);
  assert.equal(existsSync(path.join(fixture.root, 'Pods/Target Support Files/Pods-SlaxShare')), false);
  fixture.write('SlaxShare/ShareCollector.swift', 'import Foundation\nenum ShareCollector { static let changed = true }\n');
  assert.deepEqual(fixture.admit(), admission, 'Share source is not a Firebase admission input');
  checkFirebaseArchiveAdmission(admission, admission);
  assert.throws(() => checkFirebaseArchiveAdmission(undefined, admission), /fresh archive/);
  assert.throws(() => checkFirebaseArchiveAdmission({...admission, version: 1}, admission), /fresh archive/);
  assert.throws(() => checkFirebaseArchiveAdmission(admission, {...admission, version: 1}), /fresh archive/);
  assert.throws(() => checkFirebaseArchiveAdmission({...admission, nativeSHA256: 'stale'}, admission), /fresh archive/);
});

for (const target of ['SlaxReader']) {
  test(`Firebase release admission rejects missing, directory and symlink ${target} configuration resources`, t => {
    const fixture = firebaseFixture(t), filename = path.join(fixture.root, target, 'GoogleService-Info.plist');
    rmSync(filename);
    assert.throws(fixture.admit, new RegExp(`${target} is missing a regular generated`));
    mkdirSync(filename);
    assert.throws(fixture.admit, /regular generated/);
    rmSync(filename, {recursive: true});
    symlinkSync(path.join(fixture.root, target, 'Info.plist'), filename);
    assert.throws(fixture.admit, /regular generated/);
  });
  for (const phase of ['Resources', 'Sources']) test(`Firebase ${target} ${phase} membership cannot be replaced by an orphan file reference`, t => {
    const fixture = firebaseFixture(t);
    fixture.objects[`${target}${phase}`].files = [];
    fixture.saveProject();
    assert.throws(fixture.admit, new RegExp(`${target}.*${phase} build phase`));
  });
  for (const missing of ['FirebaseCore', 'FirebaseAnalytics', 'FirebaseCrashlytics']) test(`Firebase ${target} requires Release-linked ${missing}`, t => {
    const fixture = firebaseFixture(t);
    const frameworks = ['FirebaseCore', 'FirebaseAnalytics', 'FirebaseCrashlytics'].filter(name => name !== missing);
    fixture.write(`Pods/Target Support Files/Pods-${target}/Pods-${target}.release.xcconfig`, `OTHER_LDFLAGS = ${frameworks.map(name => `-framework "${name}"`).join(' ')}\n`);
    assert.throws(fixture.admit, new RegExp(`${target} Release does not link ${missing}`));
  });
}

test('Firebase admission rejects absent or commented main initialization', t => {
  const fixture = firebaseFixture(t);
  for (const source of ['import FirebaseCore\n', 'import FirebaseCore\nfunc application(didFinishLaunchingWithOptions: Any) {\n// FirebaseApp.configure()\nfactory.startReactNative()\n}\n']) {
    fixture.write('SlaxReader/AppDelegate.swift', source);
    assert.throws(fixture.admit, /main AppDelegate lacks Firebase initialization/);
  }
});

test('Firebase admission accepts the scene-based launch template', t => {
  const fixture = firebaseFixture(t);
  fixture.write('SlaxReader/AppDelegate.swift', 'import FirebaseCore\nfunc application(didFinishLaunchingWithOptions: Any) {\nFirebaseApp.configure()\nreturn super.application(didFinishLaunchingWithOptions: nil)\n}\n');
  fixture.admit();
});

for (const mutate of [objects => {objects.SlaxReader.buildPhases = objects.SlaxReader.buildPhases.filter(id => id !== 'crash');}, objects => {objects.crash.shellScript = '# "${PODS_ROOT}/FirebaseCrashlytics/run"';}, objects => {objects.crash.runOnlyForDeploymentPostprocessing = '1';}]) {
  test('Firebase admission rejects a missing or inactive Crashlytics upload phase', t => {
    const fixture = firebaseFixture(t); mutate(fixture.objects); fixture.saveProject();
    assert.throws(fixture.admit, /active Crashlytics symbol-upload phase/);
  });
}

test('archive and exported bundle resource checks require only the main configuration without reading files', t => {
  const fixture = firebaseFixture(t), bundle = path.join(fixture.root, 'SlaxReader.app');
  fixture.write('SlaxReader.app/GoogleService-Info.plist', '');
  checkFirebaseBundleResources(bundle);
  assert.equal(existsSync(path.join(bundle, 'PlugIns/SlaxShare.appex/GoogleService-Info.plist')), false);
  rmSync(path.join(bundle, 'GoogleService-Info.plist'));
  assert.throws(() => checkFirebaseBundleResources(bundle), /main artifact/);
});

test('valid signature metadata cannot bypass main telemetry safeguards and Share has no telemetry gate', () => {
  for (const exported of [false, true]) {
    for (const flags of [{FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED: true}, {FIREBASE_ANALYTICS_COLLECTION_ENABLED: false}, {FirebaseDataCollectionDefaultEnabled: false}, {FirebaseCrashlyticsCollectionEnabled: false}, {FirebaseAutomaticScreenReportingEnabled: true}]) {
      assert.throws(() => checkBundleMetadata({...mainInfo, ...flags}, entitlement, signature, release, 'app.slax.reader', exported), /Firebase admission/);
    }
    const shareInfo = {...mainInfo, CFBundleIdentifier: 'app.slax.reader.share', NSExtension: {NSExtensionPointIdentifier: 'com.apple.share-services'}, FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED: true, FirebaseCrashlyticsCollectionEnabled: false};
    delete shareInfo.FirebaseAutomaticScreenReportingEnabled;
    checkBundleMetadata(shareInfo, {...entitlement, 'application-identifier': '8G3A932HJG.app.slax.reader.share'}, signature, release, 'app.slax.reader.share', exported);
  }
});

test('all release stages reject unconfigured generated projects before creating artifacts or invoking Apple tools', {skip: process.platform !== 'darwin'}, t => {
  const fixture = firebaseFixture(t);
  rmSync(path.join(fixture.root, 'SlaxReader/GoogleService-Info.plist'));
  const output = path.join(fixture.root, 'new-output'), archive = path.join(fixture.root, 'absent.xcarchive');
  for (const args of [['archive', '--output', output], ['export', '--archive', archive, '--output', output], ['upload', '--archive', archive, '--export', output]]) {
    assert.throws(() => executeRelease(args, environment, fixture.root), /SlaxReader is missing a regular generated/);
    assert.equal(existsSync(output), false);
  }
});

test('export and upload reject an old archive report even after native configuration is repaired', {skip: process.platform !== 'darwin'}, t => {
  const fixture = firebaseFixture(t), archive = path.join(fixture.root, 'archive/SlaxReader.xcarchive');
  const origins = {SlaxApiBaseURL: 'https://api-reader.slax.com', SlaxApiBetaURL: 'https://api-reader-beta.slax.com'};
  fixture.write('SlaxReader/Info.plist', JSON.stringify({...mainInfo, ...origins}));
  fixture.write('SlaxShare/Info.plist', JSON.stringify(origins));
  mkdirSync(archive, {recursive: true});
  const canonicalArchive = path.join(realpathSync(fixture.root), 'archive/SlaxReader.xcarchive');
  fixture.write('archive/ios-release-report.json', JSON.stringify({kind: 'slax-ios-release', stage: 'archive', status: 'completed', archive: canonicalArchive, release}));
  for (const args of [['export', '--archive', archive, '--output', path.join(fixture.root, 'export')], ['upload', '--archive', archive, '--export', path.join(fixture.root, 'export')]]) {
    assert.throws(() => executeRelease(args, environment, fixture.root), /archive lacks matching native Firebase admission evidence/);
  }
});

test('archive admission uses available blocks on its output volume and rejects insufficient or unknown space', () => {
  const required = 6n * 1024n ** 3n;
  const statistics = (directory, options) => {
    assert.equal(directory, '/Volumes/Builds');
    assert.deepEqual(options, {bigint: true});
    return {bsize: 4096n, bavail: required / 4096n, bfree: required};
  };
  assert.deepEqual(archiveResourceCheck('/Volumes/Builds', statistics), {outputParent: '/Volumes/Builds', availableFreeBytes: String(required), requiredFreeBytes: String(required)});
  assert.throws(() => archiveResourceCheck('/Volumes/Builds', () => ({bsize: 4096n, bavail: required / 4096n - 1n, bfree: required})), /at least 6 GiB/);
  for (const values of [{bsize: 0n, bavail: 1n}, {bsize: 4096n, bavail: -1n}, {bsize: 4096, bavail: Number(required)}]) assert.throws(() => archiveResourceCheck('/Volumes/Builds', () => values), /unavailable/);
});

test('archive arguments preserve device release settings without overriding target signing requirements', () => {
  const args = archiveArguments(release, '/Volumes/Builds/new release');
  assert.deepEqual(args, ['-workspace', 'SlaxReader.xcworkspace', '-scheme', 'SlaxReader', '-configuration', 'Release', '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS', '-archivePath', '/Volumes/Builds/new release/SlaxReader.xcarchive', '-derivedDataPath', '/Volumes/Builds/new release/DerivedData', '-jobs', '1', '-allowProvisioningUpdates', `DEVELOPMENT_TEAM=${release.team}`, 'CODE_SIGN_STYLE=Automatic', 'archive']);
  assert.equal(args.some(arg => /^CODE_SIGNING_(?:ALLOWED|REQUIRED)=/.test(arg)), false, 'Static Pods retain their target-level signing settings; signing must not be globally forced or disabled');
});

test('archived main and share metadata still reject invalid signatures and entitlements', () => {
  const shareInfo = {...mainInfo, CFBundleIdentifier: 'app.slax.reader.share', NSExtension: {NSExtensionPointIdentifier: 'com.apple.share-services'}};
  const shareEntitlement = {...entitlement, 'application-identifier': '8G3A932HJG.app.slax.reader.share'};
  for (const [info, values] of [[mainInfo, entitlement], [shareInfo, shareEntitlement]]) {
    const bundle = info.CFBundleIdentifier;
    checkBundleMetadata(info, values, signature, release, bundle);
    for (const signed of [{}, {...signature, adHoc: true}, {...signature, appleAuthority: false}, {...signature, team: 'OTHER12345'}]) assert.throws(() => checkBundleMetadata(info, values, signed, release, bundle), /Apple signing identity/);
    for (const invalid of [{...values, 'application-identifier': `OTHER12345.${bundle}`}, {...values, 'com.apple.developer.team-identifier': 'OTHER12345'}]) assert.throws(() => checkBundleMetadata(info, invalid, signature, release, bundle), /entitlements differ/);
    assert.throws(() => checkBundleMetadata(info, {...values, 'com.apple.security.application-groups': []}, signature, release, bundle), /App Group/);
  }
  assert.throws(() => checkBundleMetadata(mainInfo, {...entitlement, 'com.apple.developer.applesignin': []}, signature, release, mainInfo.CFBundleIdentifier), /Apple sign-in/);
  assert.throws(() => checkBundleMetadata({...shareInfo, NSExtension: undefined}, shareEntitlement, signature, release, shareInfo.CFBundleIdentifier), /share extension/);
});

test('release commands cannot forward unsigned/simulator flags or change artifact identity', () => {
  assert.deepEqual(parseReleaseArguments(['archive', '--output', '/tmp/new-release']), {command: 'archive', options: {'--output': '/tmp/new-release'}});
  for (const args of [['archive', '--output', '/tmp/new', '--unsigned'], ['archive', '--output', '/tmp/new', '-sdk', 'iphonesimulator'], ['archive', '--output', '/tmp/new', 'CODE_SIGNING_ALLOWED=NO'], ['export', '--archive', '/tmp/app.xcarchive'], ['upload', '--archive', '/tmp/app.xcarchive', '--export', '../old'], ['export', '--archive', '/tmp/app.xcarchive', '--archive', '/tmp/other.xcarchive', '--output', '/tmp/new']]) assert.throws(() => parseReleaseArguments(args));
  assert.throws(() => releaseInputs({...environment, EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE: '1'}));
  assert.throws(() => releaseInputs({...environment, EXPO_PUBLIC_SLAX_UI_FIXTURE: 'library'}));
  assert.throws(() => releaseInputs(environment, {version: '1.0.25', buildNumber: 756, previousBuildNumber: 756}));
  assert.throws(() => releaseInputs(environment, {version: '1.0.25', buildNumber: Number.MAX_SAFE_INTEGER + 1, previousBuildNumber: 756}));
  assert.throws(() => releaseInputs({...environment, SLAX_APPLE_TEAM_ID: undefined}));
});

test('device metadata requires selected Apple signature, exact version and original capabilities', () => {
  checkBundleMetadata(mainInfo, entitlement, signature, release, 'app.slax.reader', true);
  for (const info of [{...mainInfo, DTPlatformName: 'iphonesimulator', CFBundleSupportedPlatforms: ['iPhoneSimulator']}, {...mainInfo, CFBundleIdentifier: 'app.slax.reader.uifixture'}, {...mainInfo, CFBundleVersion: '1'}, {...mainInfo, CFBundleShortVersionString: '1.0.24'}]) assert.throws(() => checkBundleMetadata(info, entitlement, signature, release, 'app.slax.reader', true));
  for (const signed of [{...signature, adHoc: true}, {...signature, appleAuthority: false}, {...signature, team: 'OTHER12345'}]) assert.throws(() => checkBundleMetadata(mainInfo, entitlement, signed, release, 'app.slax.reader', true));
  for (const values of [{...entitlement, 'application-identifier': '8G3A932HJG.app.slax.reader.uifixture'}, {...entitlement, 'com.apple.security.application-groups': []}, {...entitlement, 'com.apple.developer.applesignin': []}, {...entitlement, 'get-task-allow': true}]) assert.throws(() => checkBundleMetadata(mainInfo, values, signature, release, 'app.slax.reader', true));
  const shareInfo = {...mainInfo, CFBundleIdentifier: 'app.slax.reader.share', NSExtension: {NSExtensionPointIdentifier: 'com.apple.share-services'}};
  const shareEntitlement = {...entitlement, 'application-identifier': '8G3A932HJG.app.slax.reader.share'};
  checkBundleMetadata(shareInfo, shareEntitlement, signature, release, 'app.slax.reader.share', true);
  assert.throws(() => checkBundleMetadata({...shareInfo, NSExtension: undefined}, shareEntitlement, signature, release, 'app.slax.reader.share', true));
});

test('local export and explicit upload retain fixed version/build management and cannot be conflated', () => {
  const local = exportOptions(release, 'export'), upload = exportOptions(release, 'upload');
  assert.equal(local.destination, 'export'); assert.equal(upload.destination, 'upload');
  assert.equal(local.method, 'app-store-connect'); assert.equal(upload.method, 'app-store-connect');
  assert.equal(local.manageAppVersionAndBuildNumber, false); assert.equal(upload.manageAppVersionAndBuildNumber, false);
  assert.equal(local.signingStyle, 'automatic'); assert.equal(local.teamID, release.team);
  assert.throws(() => exportOptions(release, 'validation'));
});
