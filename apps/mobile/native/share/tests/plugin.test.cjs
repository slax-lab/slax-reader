const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const expoRequire = createRequire(require.resolve('expo/config-plugins'));
const pluginsRequire = createRequire(expoRequire.resolve('@expo/config-plugins'));
const xcode = pluginsRequire('xcode');
const plist = pluginsRequire('@expo/plist').default;
const helpers = require('../../../plugins/with-share.cjs')._test;
const options = helpers.normalizedOptions({version: '1.2.3', android: {versionCode: 123}}, {apiBaseUrl: 'https://api.example', apiBetaUrl: 'https://beta.example'});
function projectFixture() {
  const project = xcode.project('fixture.pbxproj');
  project.hash = {headComment: '!$*UTF8*$!', project: {archiveVersion: 1, objectVersion: 46, rootObject: 'PROJECT', objects: {
    PBXProject: {PROJECT: {isa: 'PBXProject', mainGroup: 'ROOT', targets: [{value: 'APP', comment: 'App'}]}, PROJECT_comment: 'Project object'},
    PBXNativeTarget: {APP: {isa: 'PBXNativeTarget', name: '"App"', productName: '"App"', productReference: 'PRODUCT', buildConfigurationList: 'CONFIG', buildPhases: [], dependencies: []}, APP_comment: 'App'},
    PBXGroup: {ROOT: {isa: 'PBXGroup', children: [{value: 'PRODUCTS', comment: 'Products'}], sourceTree: '"<group>"'}, PRODUCTS: {isa: 'PBXGroup', name: 'Products', children: [{value: 'PRODUCT', comment: 'App.app'}], sourceTree: '"<group>"'}, PRODUCTS_comment: 'Products'},
    PBXFileReference: {PRODUCT: {isa: 'PBXFileReference', path: 'App.app', sourceTree: 'BUILT_PRODUCTS_DIR'}},
    PBXBuildFile: {}, PBXContainerItemProxy: {}, PBXTargetDependency: {},
    XCConfigurationList: {CONFIG: {isa: 'XCConfigurationList', buildConfigurations: [{value: 'DEBUG', comment: 'Debug'}, {value: 'RELEASE', comment: 'Release'}], defaultConfigurationName: 'Release'}},
    XCBuildConfiguration: {DEBUG: {isa: 'XCBuildConfiguration', name: 'Debug', buildSettings: {DEVELOPMENT_TEAM: 'fixture-team'}}, RELEASE: {isa: 'XCBuildConfiguration', name: 'Release', buildSettings: {DEVELOPMENT_TEAM: 'fixture-team'}}},
  }}};
  return project;
}
test('share Android manifest remains idempotent and preserves unrelated configuration', () => {
  const manifest = {manifest: {application: [{$: {'android:name': '.MainApplication'}, activity: [{$: {'android:name': '.MainActivity'}}]}]}};
  helpers.updateAndroidManifest(manifest, options); const first = JSON.stringify(manifest);
  helpers.updateAndroidManifest(manifest, options); assert.equal(JSON.stringify(manifest), first);
  const application = manifest.manifest.application[0]; assert.equal(application.activity.length, 2);
  assert.equal(application.activity[1]['intent-filter'][0].data[0].$['android:mimeType'], 'text/plain');
  assert.equal(application['meta-data'].find(value => value.$['android:name'] === 'SlaxApiBetaURL').$['android:value'], 'https://beta.example');
});
test('share Xcode target generates once with original identity, source/resource membership and signing inheritance', () => {
  const project = projectFixture(); helpers.configureIosTarget(project, options); const first = project.writeSync();
  helpers.configureIosTarget(project, options); assert.equal(project.writeSync(), first);
  const [uuid, target] = helpers.targetEntry(project); assert.ok(uuid); assert.equal(String(target.productType), '"com.apple.product-type.app-extension"');
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  for (const reference of list.buildConfigurations) {
    const settings = project.pbxXCBuildConfigurationSection()[reference.value].buildSettings;
    assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER, '"app.slax.reader.share"'); assert.equal(settings.IPHONEOS_DEPLOYMENT_TARGET, '16.4'); assert.equal(settings.DEVELOPMENT_TEAM, 'fixture-team');
    assert.equal(settings.CC, 'clang'); assert.equal(settings.CXX, '"clang++"'); assert.equal(settings.LD, 'clang'); assert.equal(settings.LDPLUSPLUS, '"clang++"');
  }
  assert.equal(target.buildPhases.length, 3);
  assert.equal(Object.hasOwn(project.pbxGroupByName('SlaxShare'), 'path'), false);
  const files = project.pbxFileReferenceSection(), builds = project.pbxBuildFileSection();
  for (const file of Object.values(files).filter(file => typeof file === 'object' && String(file.path).replaceAll('"', '').startsWith('SlaxShare/'))) {
    for (const key of ['explicitFileType', 'fileEncoding']) if (Object.hasOwn(file, key)) assert.notEqual(file[key], undefined);
  }
  const source = project.hash.project.objects.PBXSourcesBuildPhase[target.buildPhases.find(value => value.comment === 'Sources').value];
  const resources = project.hash.project.objects.PBXResourcesBuildPhase[target.buildPhases.find(value => value.comment === 'Resources').value];
  assert.deepEqual(source.files.map(value => String(files[builds[value.value].fileRef].path).replaceAll('"', '')).sort(), ['SlaxShare/ShareCollector.swift', 'SlaxShare/SharePage.swift', 'SlaxShare/ShareViewController.swift', 'SlaxShare/SharedPreferences.swift']);
  assert.deepEqual(resources.files.map(value => String(files[builds[value.value].fileRef].path).replaceAll('"', '')), ['SlaxShare/ExtensionClass.js']);
});
test('share target repairs an already generated undefined virtual-group path without duplicating files', () => {
  const project = projectFixture(); helpers.configureIosTarget(project, options);
  const group = project.pbxGroupByName('SlaxShare'); group.path = 'undefined';
  helpers.configureIosTarget(project, options);
  assert.equal(Object.hasOwn(group, 'path'), false); assert.equal(helpers.targetEntry(project)[1].buildPhases.length, 3);
});
test('an existing share target restores the Safari parser and removes only its stale Firebase resource', () => {
  const project = projectFixture(); helpers.configureIosTarget(project, options);
  const [uuid] = helpers.targetEntry(project);
  const group = project.pbxGroupByName('SlaxShare');
  const groupId = Object.entries(project.hash.project.objects.PBXGroup).find(([key, value]) => !key.endsWith('_comment') && value === group)[0];
  project.removeSourceFile('SlaxShare/SharePage.swift', {target: uuid}, groupId);
  assert.equal(project.hasFile('SlaxShare/SharePage.swift'), false);
  project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', 'APP');
  const mainResource = project.addResourceFile('SlaxReader/GoogleService-Info.plist', {target: 'APP'});
  const shareResource = project.addResourceFile('SlaxShare/GoogleService-Info.plist', {target: uuid}, groupId);
  const mainBefore = JSON.stringify({phase: project.pbxResourcesBuildPhaseObj('APP'), build: project.pbxBuildFileSection()[mainResource.uuid], reference: project.pbxFileReferenceSection()[mainResource.fileRef]});
  const configured = {...options, firebaseIosConfig: 'obsolete-option-must-not-be-used.plist'};
  helpers.configureIosTarget(project, configured);
  assert.ok(project.hasFile('SlaxShare/SharePage.swift'));
  assert.equal(project.hasFile('SlaxShare/GoogleService-Info.plist'), false);
  assert.equal(project.pbxBuildFileSection()[shareResource.uuid], undefined);
  assert.equal(group.children.some(entry => entry.value === shareResource.fileRef), false);
  assert.equal(JSON.stringify({phase: project.pbxResourcesBuildPhaseObj('APP'), build: project.pbxBuildFileSection()[mainResource.uuid], reference: project.pbxFileReferenceSection()[mainResource.fileRef]}), mainBefore);
  assert.equal(project.pbxResourcesBuildPhaseObj(uuid).files.length, 1);
  const first = project.writeSync();
  helpers.configureIosTarget(project, configured);
  assert.equal(project.writeSync(), first);
});
test('Share removal preserves a main Firebase reference accidentally attached to both targets', () => {
  const project = projectFixture(); helpers.configureIosTarget(project, options);
  const [uuid] = helpers.targetEntry(project);
  project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', 'APP');
  const main = project.addResourceFile('SlaxReader/GoogleService-Info.plist', {target: 'APP'});
  project.pbxResourcesBuildPhaseObj(uuid).files.push({...project.pbxResourcesBuildPhaseObj('APP').files[0]});
  helpers.configureIosTarget(project, options);
  assert.ok(project.pbxBuildFileSection()[main.uuid]);
  assert.ok(project.pbxFileReferenceSection()[main.fileRef]);
  assert.equal(project.pbxResourcesBuildPhaseObj('APP').files.length, 1);
  assert.equal(project.pbxResourcesBuildPhaseObj(uuid).files.length, 1);
});
test('repeated prebuild detaches obsolete Share CocoaPods linkage without changing the main target', () => {
  const project = projectFixture(); helpers.configureIosTarget(project, options);
  const [uuid, target] = helpers.targetEntry(project);
  project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', 'APP');
  const main = project.addFramework('Pods_SlaxReader.framework', {target: 'APP'});
  const share = project.addFramework('Pods_SlaxShare.framework', {target: uuid});
  const group = project.addPbxGroup([], 'Pods', 'Pods');
  const configuration = project.addFile('Target Support Files/Pods-SlaxShare/Pods-SlaxShare.release.xcconfig', group.uuid);
  const configurations = project.pbxXCConfigurationList()[target.buildConfigurationList].buildConfigurations;
  for (const entry of configurations) project.pbxXCBuildConfigurationSection()[entry.value].baseConfigurationReference = configuration.fileRef;
  project.hash.project.objects.PBXShellScriptBuildPhase = {
    SHAREPODS: {isa: 'PBXShellScriptBuildPhase', name: '"[CP] Check Pods Manifest.lock"', shellScript: 'diff "${PODS_ROOT}/Manifest.lock" "${PODS_PODFILE_DIR_PATH}/Podfile.lock"', outputPaths: ['$(DERIVED_FILE_DIR)/Pods-SlaxShare-checkManifestLockResult.txt']},
    MAINPODS: {isa: 'PBXShellScriptBuildPhase', name: '"[CP] Embed Pods Frameworks"', shellScript: '"${PODS_ROOT}/Target Support Files/Pods-SlaxReader/Pods-SlaxReader-frameworks.sh"'},
  };
  target.buildPhases.push({value: 'SHAREPODS', comment: '[CP] Check Pods Manifest.lock'});
  project.pbxNativeTargetSection().APP.buildPhases.push({value: 'MAINPODS', comment: '[CP] Embed Pods Frameworks'});
  const mainBefore = JSON.stringify(project.pbxNativeTargetSection().APP);
  helpers.configureIosTarget(project, options);
  for (const entry of configurations) assert.equal(project.pbxXCBuildConfigurationSection()[entry.value].baseConfigurationReference, undefined);
  assert.equal(project.pbxBuildFileSection()[share.uuid], undefined);
  assert.equal(project.hasFile('Pods_SlaxShare.framework'), false);
  assert.ok(project.pbxBuildFileSection()[main.uuid]);
  assert.ok(project.hash.project.objects.PBXShellScriptBuildPhase.MAINPODS);
  assert.equal(project.hash.project.objects.PBXShellScriptBuildPhase.SHAREPODS, undefined);
  assert.equal(JSON.stringify(project.pbxNativeTargetSection().APP), mainBefore);
  const first = project.writeSync(); helpers.configureIosTarget(project, options);
  assert.equal(project.writeSync(), first);
});
test('repeated prebuild removes the owned Share Pod block and preserves main Firebase Pods', () => {
  const main = "target 'SlaxReader' do\n  pod 'Firebase/Analytics'\n  pod 'Firebase/Crashlytics'\nend\n\n";
  const obsolete = "# BEGIN SLAX SHARE\ntarget 'SlaxShare' do\n  use_frameworks! :linkage => :static\n  pod 'Firebase/Analytics'\nend\n# END SLAX SHARE\n";
  for (const newline of ['\n', '\r\n']) {
    const retained = main.replaceAll('\n', newline);
    const removed = helpers.removeFirebasePod((main + obsolete).replaceAll('\n', newline));
    assert.equal(removed, retained);
    assert.equal(helpers.removeFirebasePod(removed), retained);
  }
});
test('standalone share files retain preprocessing and App Group without Firebase or the host application', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'slax-share-fixture-'));
  try {
    const root = path.resolve(__dirname, '../../..'); helpers.writeIosFiles(output, root, {...options, firebaseIosConfig: '/nonexistent/obsolete-option.plist'});
    const info = plist.parse(fs.readFileSync(path.join(output, 'SlaxShare/Info.plist'), 'utf8'));
    const entitlements = plist.parse(fs.readFileSync(path.join(output, 'SlaxShare/SlaxShare.entitlements'), 'utf8'));
    assert.equal(info.NSExtension.NSExtensionPrincipalClass, '$(PRODUCT_MODULE_NAME).ShareViewController');
    assert.equal(info.NSExtension.NSExtensionAttributes.NSExtensionJavaScriptPreprocessingFile, 'ExtensionClass');
    assert.equal(info.NSExtension.NSExtensionAttributes.NSExtensionActivationRule.NSExtensionActivationSupportsWebPageWithMaxCount, 1);
    assert.equal(info.SlaxApiBaseURL, 'https://api.example'); assert.deepEqual(entitlements['com.apple.security.application-groups'], ['group.app.slax.reader']);
    assert.equal(info.CFBundleShortVersionString, options.versionName); assert.equal(info.CFBundleVersion, options.versionCode);
    const collector = fs.readFileSync(path.join(output, 'SlaxShare/ShareCollector.swift'), 'utf8');
    assert.doesNotMatch(collector, /Firebase|Analytics|GoogleService-Info/);
    assert.match(collector, /SharedPreferences\.read\(\)/);
    assert.match(collector, /\/v1\/bookmark\/add_url/);
    assert.equal(fs.existsSync(path.join(output, 'SlaxShare/GoogleService-Info.plist')), false);
  } finally {fs.rmSync(output, {recursive: true, force: true});}
});
