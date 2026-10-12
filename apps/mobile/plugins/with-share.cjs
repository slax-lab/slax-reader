const fs = require('node:fs');
const path = require('node:path');
const {withAndroidManifest, withEntitlementsPlist, withXcodeProject, withDangerousMod, withPodfile} = require('expo/config-plugins');
function plistBuild(value) {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const node = value => {
    if (typeof value === 'string') return `<string>${escape(value)}</string>`;
    if (typeof value === 'number') return `<integer>${value}</integer>`;
    if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
    if (Array.isArray(value)) return `<array>${value.map(node).join('')}</array>`;
    return `<dict>${Object.entries(value).map(([key, item]) => `<key>${escape(key)}</key>${node(item)}`).join('')}</dict>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${node(value)}</plist>\n`;
}

const TARGET = 'SlaxShare';
const GROUP = 'group.app.slax.reader';
const BUNDLE_ID = 'app.slax.reader.share';
const ACTIVITY = 'com.slax.reader.extension.ShareActivity';
const SOURCES = ['ShareViewController.swift', 'SharedPreferences.swift', 'ShareCollector.swift', 'SharePage.swift'];
function normalizedOptions(config, options) {
  const base = options.apiBaseUrl;
  if (!base || !/^https?:\/\//.test(base)) throw new Error('Slax share requires the configured public apiBaseUrl');
  if (options.apiBetaUrl && !/^https?:\/\//.test(options.apiBetaUrl)) throw new Error('Slax share apiBetaUrl must use HTTP or HTTPS');
  return {...options, apiBaseUrl: base, apiBetaUrl: options.apiBetaUrl || base, versionName: String(options.versionName || config.version || '0.0.1'), versionCode: String(options.versionCode || config.ios?.buildNumber || config.android?.versionCode || '1')};
}
function updateAndroidManifest(manifest, options) {
  const application = manifest.manifest.application[0];
  application['meta-data'] ||= [];
  for (const [name, value] of Object.entries({SlaxApiBaseURL: options.apiBaseUrl, SlaxApiBetaURL: options.apiBetaUrl, SlaxVersionName: options.versionName, SlaxVersionCode: options.versionCode})) {
    const found = application['meta-data'].find(item => item.$['android:name'] === name);
    if (found) found.$['android:value'] = value;
    else application['meta-data'].push({$: {'android:name': name, 'android:value': value}});
  }
  application.activity ||= [];
  let activity = application.activity.find(item => item.$['android:name'] === ACTIVITY);
  if (!activity) {activity = {$: {'android:name': ACTIVITY}}; application.activity.push(activity);}
  Object.assign(activity.$, {'android:exported': 'true', 'android:theme': '@style/SlaxShareTheme'});
  activity['intent-filter'] = [{action: [{$: {'android:name': 'android.intent.action.SEND'}}], category: [{$: {'android:name': 'android.intent.category.DEFAULT'}}], data: [{$: {'android:mimeType': 'text/plain'}}]}];
  return manifest;
}
function writeIosFiles(platformRoot, projectRoot, options) {
  const directory = path.join(platformRoot, TARGET);
  fs.mkdirSync(directory, {recursive: true});
  const sourceRoot = path.join(projectRoot, 'native/share/ios');
  for (const file of [...SOURCES, 'ExtensionClass.js']) fs.copyFileSync(path.join(sourceRoot, file), path.join(directory, file));
  const info = {
    CFBundleDisplayName: 'Slax Reader', CFBundleExecutable: '$(EXECUTABLE_NAME)', CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)', CFBundleInfoDictionaryVersion: '6.0', CFBundleName: '$(PRODUCT_NAME)', CFBundlePackageType: 'XPC!',
    CFBundleShortVersionString: options.versionName, CFBundleVersion: options.versionCode,
    SlaxApiBaseURL: options.apiBaseUrl, SlaxApiBetaURL: options.apiBetaUrl,
    NSExtension: {
      NSExtensionAttributes: {NSExtensionActivationRule: {NSExtensionActivationSupportsText: true, NSExtensionActivationSupportsWebURLWithMaxCount: 1, NSExtensionActivationSupportsWebPageWithMaxCount: 1}, NSExtensionJavaScriptPreprocessingFile: 'ExtensionClass'},
      NSExtensionPointIdentifier: 'com.apple.share-services', NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).ShareViewController',
    },
  };
  if (options.apiBaseUrl.startsWith('http:') || options.apiBetaUrl.startsWith('http:')) info.NSAppTransportSecurity = {NSAllowsArbitraryLoads: true};
  fs.writeFileSync(path.join(directory, 'Info.plist'), plistBuild(info));
  fs.writeFileSync(path.join(directory, 'SlaxShare.entitlements'), plistBuild({'com.apple.security.application-groups': [GROUP]}));
  if (options.firebaseIosConfig) fs.copyFileSync(path.resolve(projectRoot, options.firebaseIosConfig), path.join(directory, 'GoogleService-Info.plist'));
}
function targetEntry(project) {
  return Object.entries(project.pbxNativeTargetSection()).find(([key, target]) => !key.endsWith('_comment') && String(target.name).replaceAll('"', '') === TARGET);
}
function repairIosPaths(project) {
  // Virtual groups keep file references relative to the project root. xcode's
  // addPbxGroup serializes a missing path as the literal directory "undefined".
  for (const name of [TARGET, 'Resources']) {
    const group = project.pbxGroupByName(name);
    if (group && (group.path === undefined || group.path === 'undefined' || group.path === '"undefined"')) delete group.path;
  }
  for (const file of Object.values(project.pbxFileReferenceSection())) {
    if (typeof file !== 'object' || !String(file.path).replaceAll('"', '').startsWith(`${TARGET}/`)) continue;
    for (const key of ['explicitFileType', 'fileEncoding']) if (file[key] === undefined || file[key] === 'undefined') delete file[key];
    if (String(file.path).replaceAll('"', '').endsWith('/ExtensionClass.js')) file.lastKnownFileType = 'sourcecode.javascript';
  }
  return project;
}
function configureIosTarget(project, options) {
  let found = targetEntry(project);
  if (!found) {
    const added = project.addTarget(TARGET, 'app_extension', TARGET, BUNDLE_ID);
    const uuid = added.uuid;
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', uuid);
    const group = project.addPbxGroup([], TARGET);
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    if (!project.pbxGroupByName('Resources')) {
      const resources = project.addPbxGroup([], 'Resources');
      project.addToPbxGroup(resources.uuid, project.getFirstProject().firstProject.mainGroup);
    }
    for (const source of SOURCES) project.addSourceFile(`${TARGET}/${source}`, {target: uuid}, group.uuid);
    project.addResourceFile(`${TARGET}/ExtensionClass.js`, {target: uuid}, group.uuid);
    project.addFile(`${TARGET}/Info.plist`, group.uuid);
    project.addFile(`${TARGET}/SlaxShare.entitlements`, group.uuid);
    found = [uuid, added.pbxNativeTarget];
    const files = project.pbxBuildFileSection();
    for (const [key, file] of Object.entries(files)) {
      if (!key.endsWith('_comment') && file.fileRef === added.pbxNativeTarget.productReference) file.settings = {ATTRIBUTES: ['RemoveHeadersOnCopy', 'CodeSignOnCopy']};
    }
  }
  const [uuid, target] = found;
  const sourceGroup = project.pbxGroupByName(TARGET);
  const sourceGroupId = Object.entries(project.hash.project.objects.PBXGroup).find(([key, value]) => !key.endsWith('_comment') && value === sourceGroup)?.[0];
  for (const source of SOURCES) {
    if (!project.hasFile(`${TARGET}/${source}`)) project.addSourceFile(`${TARGET}/${source}`, {target: uuid}, sourceGroupId);
  }
  if (options.firebaseIosConfig && !project.hasFile(`${TARGET}/GoogleService-Info.plist`)) {
    const group = project.pbxGroupByName(TARGET);
    const groups = project.hash.project.objects.PBXGroup;
    const groupId = Object.entries(groups).find(([key, value]) => !key.endsWith('_comment') && value === group)?.[0];
    project.addResourceFile(`${TARGET}/GoogleService-Info.plist`, {target: uuid}, groupId);
  }
  repairIosPaths(project);
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  for (const entry of list.buildConfigurations) {
    const settings = project.pbxXCBuildConfigurationSection()[entry.value].buildSettings;
    Object.assign(settings, {PRODUCT_BUNDLE_IDENTIFIER: `"${BUNDLE_ID}"`, PRODUCT_NAME: `"${TARGET}"`, INFOPLIST_FILE: `"${TARGET}/Info.plist"`, CODE_SIGN_ENTITLEMENTS: `"${TARGET}/SlaxShare.entitlements"`, IPHONEOS_DEPLOYMENT_TARGET: '16.4', SWIFT_VERSION: '5.9', TARGETED_DEVICE_FAMILY: '"1,2"', APPLICATION_EXTENSION_API_ONLY: 'YES', SKIP_INSTALL: 'YES', CURRENT_PROJECT_VERSION: options.versionCode, MARKETING_VERSION: options.versionName, GENERATE_INFOPLIST_FILE: 'NO'});
    const mainTarget = project.getFirstTarget().firstTarget;
    const mainList = project.pbxXCConfigurationList()[mainTarget.buildConfigurationList];
    const matching = mainList.buildConfigurations.find(item => item.comment === entry.comment);
    const mainSettings = matching && project.pbxXCBuildConfigurationSection()[matching.value].buildSettings;
    if (mainSettings?.DEVELOPMENT_TEAM) settings.DEVELOPMENT_TEAM = mainSettings.DEVELOPMENT_TEAM;
    if (mainSettings?.CODE_SIGN_STYLE) settings.CODE_SIGN_STYLE = mainSettings.CODE_SIGN_STYLE;
  }
  return project;
}
function withShare(config, input = {}) {
  const options = normalizedOptions(config, input);
  config = withEntitlementsPlist(config, mod => {mod.modResults['com.apple.security.application-groups'] = [...new Set([...(mod.modResults['com.apple.security.application-groups'] || []), GROUP])]; return mod;});
  config = withAndroidManifest(config, mod => {mod.modResults = updateAndroidManifest(mod.modResults, options); return mod;});
  config = withDangerousMod(config, ['ios', async mod => {writeIosFiles(mod.modRequest.platformProjectRoot, mod.modRequest.projectRoot, options); return mod;}]);
  config = withXcodeProject(config, mod => {configureIosTarget(mod.modResults, options); return mod;});
  if (options.firebaseIosConfig) config = withPodfile(config, mod => {
    const begin = '# BEGIN SLAX SHARE', end = '# END SLAX SHARE';
    const block = `${begin}\ntarget '${TARGET}' do\n  use_frameworks! :linkage => :static\n  pod 'Firebase/Analytics'\nend\n${end}`;
    mod.modResults.contents = mod.modResults.contents.replace(new RegExp(`${begin}[\\s\\S]*?${end}\\n?`, 'g'), '').trimEnd() + `\n\n${block}\n`;
    return mod;
  });
  return config;
}
module.exports = withShare;
module.exports._test = {normalizedOptions, updateAndroidManifest, writeIosFiles, configureIosTarget, repairIosPaths, targetEntry, plistBuild};
