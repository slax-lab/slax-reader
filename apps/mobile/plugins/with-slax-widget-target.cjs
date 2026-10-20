const fs = require('node:fs');
const path = require('node:path');
const {createRunOncePlugin, withDangerousMod, withXcodeProject} = require('expo/config-plugins');

const TARGET = 'ExpoWidgetsTarget';
const SOURCE = 'SlaxReadingWidget.swift';

function withSlaxWidgetTarget(config) {
  config = withDangerousMod(config, ['ios', async value => {
    const targetDirectory = path.join(value.modRequest.platformProjectRoot, TARGET);
    const indexPath = path.join(targetDirectory, 'index.swift');
    if (!fs.existsSync(indexPath)) throw new Error('Expo Widgets target must be generated before the Slax widget target plugin runs');
    fs.copyFileSync(path.join(__dirname, 'slax-reading-widget.swift'), path.join(targetDirectory, SOURCE));
    const index = fs.readFileSync(indexPath, 'utf8');
    let updated = index;
    if (!index.includes('SlaxReadingWidget()')) {
      updated = index.replace(/(var body: some Widget\s*\{)/, '$1\n    SlaxReadingWidget()');
      if (updated === index) throw new Error('Unable to add SlaxReadingWidget to generated WidgetBundle');
    }
    updated = updated.replace(/[\t ]+$/gm, '');
    if (updated !== index) fs.writeFileSync(indexPath, updated);
    return value;
  }]);

  config = withXcodeProject(config, value => {
    const project = value.modResults;
    const target = Object.entries(project.pbxNativeTargetSection()).find(([key, item]) => !key.endsWith('_comment') && String(item.name).replaceAll('"', '') === TARGET);
    if (!target) throw new Error('Expo Widgets extension target is missing');
    const [targetUuid, widgetTarget] = target;
    const version = value.version, buildNumber = value.ios?.buildNumber;
    if (!version || !buildNumber) throw new Error('Slax widget target requires configured marketing and build versions');
    const configurations = project.pbxXCConfigurationList()[widgetTarget.buildConfigurationList]?.buildConfigurations;
    if (!configurations?.length) throw new Error('Expo Widgets target build configurations are missing');
    for (const entry of configurations) {
      const settings = project.pbxXCBuildConfigurationSection()[entry.value]?.buildSettings;
      if (!settings) throw new Error('Expo Widgets target build settings are missing');
      settings.MARKETING_VERSION = version;
      settings.CURRENT_PROJECT_VERSION = String(buildNumber);
    }
    const group = project.pbxGroupByName(TARGET);
    const groupId = group && Object.entries(project.hash.project.objects.PBXGroup).find(([key, item]) => !key.endsWith('_comment') && item === group)?.[0];
    const wrongPath = `${TARGET}/${SOURCE}`;
    if (project.hasFile(wrongPath)) project.removeSourceFile(wrongPath, {target: targetUuid}, groupId);
    if (!project.hasFile(SOURCE)) project.addSourceFile(SOURCE, {target: targetUuid}, groupId);
    const appTarget = Object.entries(project.pbxNativeTargetSection()).find(([key, item]) => !key.endsWith('_comment') && String(item.name).replaceAll('"', '') === 'SlaxReader');
    if (appTarget) {
      const phases = project.hash.project.objects;
      const entries = [...Object.entries(phases.PBXCopyFilesBuildPhase || {}), ...Object.entries(phases.PBXShellScriptBuildPhase || {})];
      const phaseName = id => {
        const phase = entries.find(([key]) => key === id)?.[1];
        return String(phase?.name || '').replaceAll('"', '');
      };
      const buildPhases = appTarget[1].buildPhases || [];
      const extensionPhaseIndex = buildPhases.findIndex(({value}) => phaseName(value) === 'Embed Foundation Extensions');
      const firebasePhaseIndex = buildPhases.findIndex(({value}) => phaseName(value) === '[CP-User] [RNFB] Core Configuration');
      if (extensionPhaseIndex >= 0 && firebasePhaseIndex >= 0 && extensionPhaseIndex > firebasePhaseIndex) {
        const [extensionPhase] = buildPhases.splice(extensionPhaseIndex, 1);
        buildPhases.splice(firebasePhaseIndex, 0, extensionPhase);
      }
    }
    return value;
  });
  return config;
}

module.exports = createRunOncePlugin(withSlaxWidgetTarget, 'with-slax-widget-target', '1.0.0');
