const fs = require('node:fs');
const path = require('node:path');
const {withAndroidManifest, withDangerousMod, withInfoPlist, withPodfile, withXcodeProject} = require('expo/config-plugins');

const TARGET = 'ExpoWidgetsTarget';
const unquote = value => String(value ?? '').replaceAll('"', '');

/** Remove only the retired, app-owned extension graph; preserve Share and shared App Group configuration. */
function removeWidgetTarget(project) {
  const sections = project.hash.project.objects, owned = new Set();
  const entries = section => Object.entries(sections[section] ?? {}).filter(([id]) => !id.endsWith('_comment'));
  const ownGroup = id => {
    if (owned.has(id)) return;
    owned.add(id);
    for (const child of sections.PBXGroup?.[id]?.children ?? []) ownGroup(child.value);
  };
  for (const [id, group] of entries('PBXGroup')) if ([group.name, group.path].some(value => unquote(value) === TARGET)) ownGroup(id);
  for (const [id, file] of entries('PBXFileReference')) {
    if ([file.path, file.name].some(value => unquote(value).includes(TARGET))) owned.add(id);
  }
  for (const [id, target] of entries('PBXNativeTarget')) {
    if (unquote(target.name) !== TARGET) continue;
    owned.add(id); owned.add(target.productReference); owned.add(target.buildConfigurationList);
    for (const phase of target.buildPhases ?? []) owned.add(phase.value);
    for (const configuration of sections.XCConfigurationList?.[target.buildConfigurationList]?.buildConfigurations ?? []) owned.add(configuration.value);
  }
  for (const [id, file] of entries('PBXBuildFile')) if (owned.has(file.fileRef)) owned.add(id);
  for (const [id, proxy] of entries('PBXContainerItemProxy')) if (owned.has(proxy.remoteGlobalIDString)) owned.add(id);
  for (const [id, dependency] of entries('PBXTargetDependency')) if (owned.has(dependency.target) || owned.has(dependency.targetProxy)) owned.add(id);
  for (const [id, phase] of entries('PBXCopyFilesBuildPhase')) {
    if (unquote(phase.name) === 'Embed Foundation Extensions' && (phase.files ?? []).every(file => owned.has(file.value))) owned.add(id);
  }
  const pruneReferences = value => {
    if (Array.isArray(value)) return value.filter(item => !owned.has(typeof item === 'object' ? item?.value : item)).map(pruneReferences);
    if (!value || typeof value !== 'object') return value;
    for (const [key, child] of Object.entries(value)) {
      if (owned.has(key) || owned.has(key.replace(/_comment$/, '')) || typeof child === 'string' && owned.has(child)) delete value[key];
      else value[key] = pruneReferences(child);
    }
    return value;
  };
  pruneReferences(sections);
  return project;
}

function removeWidgetPodfile(contents) {
  // Expo appends this exact owned target. Count Ruby blocks to leave later Share/operator hooks intact.
  const lines = contents.split('\n'), output = [];
  let depth = 0;
  for (const line of lines) {
    if (!depth && /^\s*target\s+["']ExpoWidgetsTarget["']\s+do\s*$/.test(line)) {depth = 1; continue;}
    if (depth) {
      if (/^\s*(if|unless|case|begin|while|until|for|def|class|module)\b/.test(line) || /\bdo(?:\s*\|[^|]*\|)?\s*$/.test(line)) depth++;
      if (/^\s*end\s*$/.test(line)) depth--;
      continue;
    }
    if (line.includes("require.resolve('expo-widgets/package.json')") || /^\s*expo_widgets_post_install\(installer\)\s*$/.test(line)) continue;
    output.push(line);
  }
  if (depth) throw new Error('Unable to locate the end of the retired ExpoWidgetsTarget Podfile block');
  return output.join('\n');
}

module.exports = function withRetireReadingWidgets(config) {
  config = withXcodeProject(config, mod => {mod.modResults = removeWidgetTarget(mod.modResults); return mod;});
  config = withPodfile(config, mod => {mod.modResults.contents = removeWidgetPodfile(mod.modResults.contents); return mod;});
  config = withInfoPlist(config, mod => {
    for (const key of Object.keys(mod.modResults)) if (key.startsWith('ExpoWidgets') || key.startsWith('NSSupportsLiveActivities')) delete mod.modResults[key];
    return mod;
  });
  config = withDangerousMod(config, ['ios', async mod => {
    fs.rmSync(path.join(mod.modRequest.platformProjectRoot, TARGET), {recursive: true, force: true});
    return mod;
  }]);
  return withAndroidManifest(config, mod => {
    for (const application of mod.modResults.manifest.application ?? []) {
      if (application.receiver) application.receiver = application.receiver.filter(receiver => receiver.$?.['android:name'] !== 'com.slax.reader.platform.SlaxReadingWidgetProvider');
    }
    return mod;
  });
};
module.exports.removeWidgetTarget = removeWidgetTarget;
module.exports.removeWidgetPodfile = removeWidgetPodfile;
