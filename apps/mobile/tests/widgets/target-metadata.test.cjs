const {test} = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../../plugins/with-slax-widget-target.cjs');

function fixture() {
  const targets = {
    app: {name: 'SlaxReader', buildConfigurationList: 'app-list', buildPhases: []},
    widget: {name: 'ExpoWidgetsTarget', buildConfigurationList: 'widget-list'},
  };
  const configurations = {
    'app-debug': {buildSettings: {CURRENT_PROJECT_VERSION: '773', MARKETING_VERSION: '1.0.25'}},
    'widget-debug': {buildSettings: {CURRENT_PROJECT_VERSION: '772', MARKETING_VERSION: '1.0.24', PRODUCT_BUNDLE_IDENTIFIER: 'app.slax.reader.widgets'}},
    'widget-release': {buildSettings: {CURRENT_PROJECT_VERSION: '772', MARKETING_VERSION: '1.0.24', CODE_SIGN_ENTITLEMENTS: 'ExpoWidgetsTarget/ExpoWidgetsTarget.entitlements'}},
  };
  const lists = {
    'app-list': {buildConfigurations: [{value: 'app-debug', comment: 'Debug'}]},
    'widget-list': {buildConfigurations: [{value: 'widget-debug', comment: 'Debug'}, {value: 'widget-release', comment: 'Release'}]},
  };
  const project = {
    hash: {project: {objects: {PBXGroup: {}}}},
    pbxNativeTargetSection: () => targets,
    pbxXCConfigurationList: () => lists,
    pbxXCBuildConfigurationSection: () => configurations,
    pbxGroupByName: () => undefined,
    hasFile: file => file === 'SlaxReadingWidget.swift',
  };
  return {project, configurations, lists};
}

async function generate(project, buildNumber = '774') {
  const config = plugin({version: '1.0.25', ios: {buildNumber}});
  return config.mods.ios.xcodeproj({modResults: project, modRequest: {}, modRawConfig: {}});
}

test('existing widget Debug and Release versions follow configured metadata on every regeneration', async () => {
  const {project, configurations} = fixture();
  await generate(project);
  await generate(project);
  for (const key of ['widget-debug', 'widget-release']) {
    assert.equal(configurations[key].buildSettings.CURRENT_PROJECT_VERSION, '774');
    assert.equal(configurations[key].buildSettings.MARKETING_VERSION, '1.0.25');
  }
  assert.equal(configurations['widget-debug'].buildSettings.PRODUCT_BUNDLE_IDENTIFIER, 'app.slax.reader.widgets');
  assert.equal(configurations['widget-release'].buildSettings.CODE_SIGN_ENTITLEMENTS, 'ExpoWidgetsTarget/ExpoWidgetsTarget.entitlements');
  assert.deepEqual(configurations['app-debug'].buildSettings, {CURRENT_PROJECT_VERSION: '773', MARKETING_VERSION: '1.0.25'});
  await generate(project, '775');
  assert.equal(configurations['widget-debug'].buildSettings.CURRENT_PROJECT_VERSION, '775');
  assert.equal(configurations['widget-release'].buildSettings.CURRENT_PROJECT_VERSION, '775');
});

test('missing widget configuration references fail instead of silently retaining stale build metadata', async () => {
  const {project, lists} = fixture();
  lists['widget-list'].buildConfigurations.push({value: 'missing-configuration', comment: 'Custom'});
  await assert.rejects(generate(project), /Expo Widgets target build settings are missing/);
});
