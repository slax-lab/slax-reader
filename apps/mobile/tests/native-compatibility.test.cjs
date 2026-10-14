const {test} = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugins/with-native-compatibility.cjs');
const {spawnSync} = require('node:child_process');

async function mod(platform, name, input, fixtureMode = false) {
  const config = plugin({}, {fixtureMode});
  return (await config.mods[platform][name]({modResults: input, modRequest: {}, modRawConfig: {}})).modResults;
}

test('manifest overrides library analytics defaults and removes fixture flags on production regeneration', async () => {
  const manifest = {manifest: {$: {}, application: [{$: {}, 'meta-data': [{$: {'android:name': 'unrelated', 'android:value': 'preserved'}}]}]}};
  await mod('android', 'manifest', manifest, true);
  const app = manifest.manifest.application[0];
  const data = name => app['meta-data'].find(item => item.$['android:name'] === name)?.$;
  assert.equal(app.$['android:usesCleartextTraffic'], 'true');
  assert.equal(data('google_analytics_automatic_screen_reporting_enabled')['android:value'], 'false');
  assert.equal(data('google_analytics_automatic_screen_reporting_enabled')['tools:replace'], 'android:value');
  assert.equal(data('firebase_analytics_collection_deactivated')['android:value'], 'true');
  assert.equal(data('firebase_crashlytics_collection_enabled')['android:value'], 'false');
  await mod('android', 'manifest', manifest, true);
  assert.equal(app['meta-data'].length, 4);
  await mod('android', 'manifest', manifest);
  assert.equal(data('firebase_analytics_collection_deactivated'), undefined);
  assert.equal(data('firebase_crashlytics_collection_enabled'), undefined);
  assert.equal(data('unrelated')['android:value'], 'preserved');
});

test('release signing removes template debug identity and remains operator managed after regeneration', async () => {
  const input = {contents: 'android { buildTypes { debug { signingConfig = signingConfigs.debug } release {\n signingConfig = signingConfigs.debug\n minifyEnabled enableMinify\n } } }'};
  const result = await mod('android', 'appBuildGradle', input);
  assert.match(result.contents, /debug \{ signingConfig = signingConfigs.debug/);
  assert.match(result.contents, /release \{\s+signingConfig = null/);
  assert.match(result.contents, /minifyEnabled enableMinify/);
  assert.match(result.contents, /SLAX_MOBILE_UNSIGNED/);
  const again = await mod('android', 'appBuildGradle', {contents: result.contents});
  assert.equal(again.contents, result.contents);
  assert.equal(result.contents.split('// Slax release signing: operator-managed environment only.').length, 2);
});

test('owned native defaults preserve platform floors and the source light theme', async () => {
  const gradle = await mod('android', 'gradleProperties', [{type: 'property', key: 'android.minSdkVersion', value: '24'}]);
  assert.equal(gradle.find(item => item.key === 'android.minSdkVersion').value, '26');
  assert.equal(gradle.find(item => item.key === 'android.targetSdkVersion').value, '36');
  const pods = await mod('ios', 'podfileProperties', {});
  assert.equal(pods['ios.deploymentTarget'], '16.4');
  assert.equal(pods['ios.useFrameworks'], 'static');
  const styles = await mod('android', 'styles', {resources: {style: [{$: {name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar'}}]}});
  assert.equal(styles.resources.style[0].$.parent, 'Theme.AppCompat.Light.NoActionBar');
});

test('CocoaPods retains configured Crashlytics upload and removes only the unconfigured phase', async t => {
  const ruby = spawnSync('ruby', ['--version'], {encoding: 'utf8'});
  if (ruby.error) return t.skip('Ruby is required only on the CocoaPods build host');
  for (const configured of [false, true]) {
    const config = plugin(configured ? {ios: {googleServicesFile: '/operator/configuration-not-opened'}} : {});
    const input = {contents: "target 'SlaxReader' do\n  post_install do |installer|\n  end\nend\n"};
    const first = (await config.mods.ios.podfile({modResults: input, modRequest: {}, modRawConfig: {}})).modResults.contents;
    const second = (await config.mods.ios.podfile({modResults: {contents: first}, modRequest: {}, modRawConfig: {}})).modResults.contents;
    assert.equal(first, second);
    const hook = first.slice(first.indexOf('# Slax unconfigured Firebase build phase: begin'));
    const harness = `
      Phase = Struct.new(:name, :removed) do
        def remove_from_project; self.removed = true; end
      end
      Target = Struct.new(:shell_script_build_phases)
      Project = Struct.new(:native_targets, :saved) do
        def save; self.saved = true; end
      end
      Aggregate = Struct.new(:user_project)
      Installer = Struct.new(:aggregate_targets)
      crash = Phase.new('[CP-User] [RNFB] Crashlytics Configuration', false)
      peer = Phase.new('[CP] Embed Pods Frameworks', false)
      project = Project.new([Target.new([crash, peer])], false)
      def post_integrate(&block); $slax_hook = block; end
      ${hook}
      $slax_hook.call(Installer.new([Aggregate.new(project), Aggregate.new(project)]))
      abort 'Wrong Crashlytics configuration' unless crash.removed == ${!configured}
      abort 'Unrelated build phase removed' if peer.removed
      abort 'Wrong project-save behavior' unless project.saved == ${!configured}
    `;
    const result = spawnSync('ruby', ['-e', harness], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
  }
});

test('requested prebuilt dependencies cannot silently produce a mixed native graph', async () => {
  const input = {contents: "target 'SlaxReader' do\n  post_install do |installer|\n  end\nend\n"};
  const result = await mod('ios', 'podfile', input);
  const guard = result.contents.match(/    # Slax prebuilt React dependency consistency\n([\s\S]*?    end\n)/)[1];
  for (const [coreSource, depsSource, shouldPass] of [[false, false, true], [false, true, false], [true, false, false]]) {
    const ruby = `ENV['RCT_USE_PREBUILT_RNCORE']='1'; ENV['RCT_USE_RN_DEP']='1'; class ReactNativeCoreUtils; def self.build_rncore_from_source(); ${coreSource}; end; end; class ReactNativeDependenciesUtils; def self.build_react_native_deps_from_source(); ${depsSource}; end; end; ${guard}`;
    const run = spawnSync('ruby', ['-e', ruby], {encoding: 'utf8'});
    assert.equal(run.status === 0, shouldPass, run.stderr);
  }
});
