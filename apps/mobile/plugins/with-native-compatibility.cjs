const { withGradleProperties, withPodfileProperties, withPodfile, withAndroidManifest, withAppBuildGradle, withAndroidStyles, withXcodeProject } = require('expo/config-plugins');
const withNativeBack = require('./with-native-back.cjs');
const {marker, removeTemplateDebugSigning} = require('./android-release-signing.cjs');

/** Normalize our inline directory before Expo's post-mod updater compares raw path strings. */
function normalizeAppIntentsGroups(project) {
  const objects = project.hash.project.objects;
  const section = objects.PBXFileSystemSynchronizedRootGroup ?? {};
  const unquote = value => String(value ?? '').replace(/^"(.*)"$/, '$1');
  const groups = Object.entries(section).filter(([id, group]) => !id.endsWith('_comment') && unquote(group.sourceTree) === 'SOURCE_ROOT' && unquote(group.path) === '../app-intents');
  if (!groups.length) return project;
  const settings = group => JSON.stringify([group.exceptions ?? [], group.explicitFileTypes ?? {}, group.explicitFolders ?? []]);
  const [canonical, first] = groups[0];
  if (groups.some(([, group]) => settings(group) !== settings(first))) throw new Error('Conflicting app-intents synchronized group settings; refusing to discard source exceptions');
  const ids = new Set(groups.map(([id]) => id));
  const normalizeReferences = references => {
    const seen = new Set();
    return references.map(reference => ids.has(reference.value) ? {...reference, value: canonical} : reference).filter(reference => {
      if (!ids.has(reference.value)) return true;
      if (seen.has(reference.value)) return false;
      seen.add(reference.value); return true;
    });
  };
  first.path = '../app-intents';
  for (const [id] of groups.slice(1)) {delete section[id]; delete section[`${id}_comment`];}
  for (const [id, group] of Object.entries(objects.PBXGroup ?? {})) if (!id.endsWith('_comment') && group.children) group.children = normalizeReferences(group.children);
  for (const [id, target] of Object.entries(objects.PBXNativeTarget ?? {})) if (!id.endsWith('_comment') && target.fileSystemSynchronizedGroups) target.fileSystemSynchronizedGroups = normalizeReferences(target.fileSystemSynchronizedGroups);
  return project;
}

module.exports = function withNativeCompatibility(config, {fixtureMode = false} = {}) {
  const firebaseIosConfigured = !fixtureMode && Boolean(config.ios?.googleServicesFile);
  config = withXcodeProject(config, mod => {mod.modResults = normalizeAppIntentsGroups(mod.modResults); return mod;});
  config = withNativeBack(config);
  config = withGradleProperties(config, mod => {
    const values = { 'android.minSdkVersion': '26', 'android.compileSdkVersion': '37', 'android.targetSdkVersion': '36' };
    for (const [key, value] of Object.entries(values)) {
      const property = mod.modResults.find(item => item.type === 'property' && item.key === key);
      if (property) property.value = value;
      else mod.modResults.push({ type: 'property', key, value });
    }
    return mod;
  });
  config = withPodfileProperties(config, mod => {
    mod.modResults['ios.deploymentTarget'] = '16.4';
    mod.modResults['ios.useFrameworks'] = 'static';
    return mod;
  });
  config = withAndroidManifest(config, mod => {
    const application = mod.modResults.manifest.application[0];
    application.$['android:usesCleartextTraffic'] = 'true';
    const metadata = application['meta-data'] ??= [];
    mod.modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const setMetadata = (name, value) => {
      let item = metadata.find(item => item.$['android:name'] === name);
      if (!item) { item = {$: {'android:name': name}}; metadata.push(item); }
      Object.assign(item.$, {'android:value': value, 'tools:replace': 'android:value'});
    };
    setMetadata('google_analytics_automatic_screen_reporting_enabled', 'false');
    if (fixtureMode) {
      for (const [name, value] of Object.entries({firebase_analytics_collection_deactivated: 'true', firebase_crashlytics_collection_enabled: 'false'})) {
        setMetadata(name, value);
      }
    } else {
      application['meta-data'] = metadata.filter(item => !['firebase_analytics_collection_deactivated', 'firebase_crashlytics_collection_enabled'].includes(item.$['android:name']));
    }
    return mod;
  });
  config = withAndroidStyles(config, mod => {
    const appTheme = mod.modResults.resources.style.find(style => style.$.name === 'AppTheme');
    if (appTheme) appTheme.$.parent = 'Theme.AppCompat.Light.NoActionBar';
    return mod;
  });
  config = withAppBuildGradle(config, mod => {
    mod.modResults.contents = removeTemplateDebugSigning(mod.modResults.contents);
    if (mod.modResults.contents.includes(marker)) return mod;
    mod.modResults.contents += `\n${marker}\nif (System.getenv('SLAX_MOBILE_UNSIGNED') != '1' && System.getenv('SLAX_ANDROID_KEYSTORE_PATH')) {\n    android.signingConfigs.create('slaxRelease') {\n        storeFile file(System.getenv('SLAX_ANDROID_KEYSTORE_PATH'))\n        storePassword System.getenv('SLAX_ANDROID_KEYSTORE_PASSWORD')\n        keyAlias System.getenv('SLAX_ANDROID_KEY_ALIAS')\n        keyPassword System.getenv('SLAX_ANDROID_KEY_PASSWORD')\n    }\n    android.buildTypes.release.signingConfig = android.signingConfigs.slaxRelease\n}\n`;
    return mod;
  });
  return withPodfile(config, mod => {
    if (!mod.modResults.contents.includes('$RNFirebaseDisableSPM')) mod.modResults.contents = `$RNFirebaseDisableSPM = true\n${mod.modResults.contents}`;
    if (!mod.modResults.contents.includes('$RNFirebaseAsStaticFramework')) mod.modResults.contents = `$RNFirebaseAsStaticFramework = true\n${mod.modResults.contents}`;
    const modules = ["AppCheckCore", "GoogleUtilities", "RecaptchaInterop"];
    const missing = modules.filter(name => !mod.modResults.contents.includes(`pod '${name}'`));
    if (missing.length) mod.modResults.contents = mod.modResults.contents.replace(/(target 'SlaxReader' do\n)/, `$1${missing.map(name => `  pod '${name}', :modular_headers => true`).join('\n')}\n`);
    const dependencyGuard = `    if (ENV['RCT_USE_PREBUILT_RNCORE'] == '1' && ReactNativeCoreUtils.build_rncore_from_source()) || (ENV['RCT_USE_RN_DEP'] == '1' && ReactNativeDependenciesUtils.build_react_native_deps_from_source())\n      raise 'Requested prebuilt React artifacts are unavailable. Restore artifact access and retry pod install; refusing an inconsistent native dependency graph.'\n    end`;
    mod.modResults.contents = mod.modResults.contents.replace(/^    #[^\n]*\n(?=    if \(ENV\['RCT_USE_PREBUILT_RNCORE'\])/m, '');
    const hook = '  post_install do |installer|';
    if (!mod.modResults.contents.includes(hook)) throw new Error('Cannot install the React Native dependency consistency check');
    if (!mod.modResults.contents.includes(dependencyGuard)) mod.modResults.contents = mod.modResults.contents.replace(hook, `${hook}\n${dependencyGuard}\n`);
    // Autolinking adds Crashlytics' symbol-upload phase even without Expo SDK bootstrap.
    // CocoaPods integrates user script phases after post_install, so adjust only that
    // generated phase after integration. Configured operator builds retain the SDK phase.
    const begin = '# Slax unconfigured Firebase build phase: begin';
    const end = '# Slax unconfigured Firebase build phase: end';
    mod.modResults.contents = mod.modResults.contents.replace(/\n?# Slax unconfigured Firebase build phase: begin[\s\S]*?# Slax unconfigured Firebase build phase: end\n?/g, '\n').trimEnd();
    mod.modResults.contents += `\n\n${begin}\npost_integrate do |installer|\n  unless ${firebaseIosConfigured}\n    installer.aggregate_targets.map(&:user_project).uniq.each do |project|\n      project.native_targets.each do |target|\n        target.shell_script_build_phases.select { |phase| phase.name == '[CP-User] [RNFB] Crashlytics Configuration' }.each(&:remove_from_project)\n      end\n      project.save\n    end\n  end\nend\n${end}\n`;
    return mod;
  });
};
module.exports.normalizeAppIntentsGroups = normalizeAppIntentsGroups;
