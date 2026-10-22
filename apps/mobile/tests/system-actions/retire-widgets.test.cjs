const test = require('node:test');
const assert = require('node:assert/strict');
const {removeWidgetPodfile, removeWidgetTarget} = require('../../plugins/with-retire-reading-widgets.cjs');

test('retirement removes only the owned extension and is idempotent', () => {
  const objects = {
    PBXNativeTarget: {MAIN: {name: 'SlaxReader', dependencies: [{value: 'WIDGET_DEP'}, {value: 'SHARE_DEP'}]}, WIDGET: {name: 'ExpoWidgetsTarget', productReference: 'PRODUCT', buildConfigurationList: 'CONFIGS', buildPhases: [{value: 'SOURCES'}]}, SHARE: {name: 'SlaxShare'}},
    PBXGroup: {ROOT: {children: [{value: 'GROUP'}, {value: 'SHARE_GROUP'}]}, GROUP: {name: 'ExpoWidgetsTarget', children: [{value: 'SOURCE'}]}, SHARE_GROUP: {name: 'SlaxShare'}},
    PBXFileReference: {PRODUCT: {path: 'ExpoWidgetsTarget.appex'}, SOURCE: {path: 'index.swift'}, SHARE_PRODUCT: {path: 'SlaxShare.appex'}},
    PBXBuildFile: {BUILD: {fileRef: 'SOURCE'}}, PBXSourcesBuildPhase: {SOURCES: {files: [{value: 'BUILD'}]}},
    XCConfigurationList: {CONFIGS: {buildConfigurations: [{value: 'DEBUG'}]}}, XCBuildConfiguration: {DEBUG: {buildSettings: {CURRENT_PROJECT_VERSION: '774'}}},
    PBXTargetDependency: {WIDGET_DEP: {target: 'WIDGET'}, SHARE_DEP: {target: 'SHARE'}},
    PBXProject: {PROJECT: {targets: [{value: 'MAIN'}, {value: 'WIDGET'}, {value: 'SHARE'}], attributes: {TargetAttributes: {WIDGET: {}, SHARE: {}}}}},
  };
  const project = {hash: {project: {objects}}};
  removeWidgetTarget(project);
  assert.deepEqual(Object.keys(objects.PBXNativeTarget), ['MAIN', 'SHARE']);
  assert.deepEqual(objects.PBXProject.PROJECT.targets, [{value: 'MAIN'}, {value: 'SHARE'}]);
  assert.deepEqual(objects.PBXNativeTarget.MAIN.dependencies, [{value: 'SHARE_DEP'}]);
  assert.equal(objects.PBXGroup.SHARE_GROUP.name, 'SlaxShare');
  assert.equal(objects.PBXFileReference.SHARE_PRODUCT.path, 'SlaxShare.appex');
  const once = JSON.stringify(objects); removeWidgetTarget(project); assert.equal(JSON.stringify(objects), once);
});

test('retired Podfile target removal preserves nested main and later Share/operator hooks', () => {
  const main = "target 'SlaxReader' do\n  post_install do |installer|\n    expo_widgets_post_install(installer)\n    keep_main(installer)\n  end\nend\n";
  const widget = 'require File.join(File.dirname(`node --print "require.resolve(\'expo-widgets/package.json\')"`), "scripts/autolinking")\ntarget "ExpoWidgetsTarget" do\n  if ENV[\'FIXTURE\']\n    retained_only_in_old_target()\n  end\nend\n';
  const share = "target 'SlaxShare' do\n  keep_share()\nend\npost_integrate do |installer|\n  keep_operator(installer)\nend\n";
  const actual = removeWidgetPodfile(main + widget + share);
  assert.equal(actual, main.replace('    expo_widgets_post_install(installer)\n', '') + share);
  assert.equal(removeWidgetPodfile(actual), actual);
});
