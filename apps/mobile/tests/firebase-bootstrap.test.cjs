const {test} = require('node:test');
const assert = require('node:assert/strict');
const bootstrap = require('../plugins/with-firebase-bootstrap.cjs');
const compatibility = require('../plugins/with-native-compatibility.cjs');
const path = require('node:path');

test('unconfigured Firebase bootstrap preserves ordinary native mods', () => {
  const config = compatibility({});
  assert.equal(bootstrap(config), config);
});

test('configured Firebase SDK mods are limited to their platform and retain unrelated mods', () => {
  for (const platform of ['android', 'ios']) {
    const config = compatibility({_internal: {projectRoot: path.resolve(__dirname, '..')}, [platform]: {googleServicesFile: '/operator/configuration-not-opened'}});
    const other = platform === 'android' ? 'ios' : 'android';
    const previous = {...config.mods[other]};
    const result = bootstrap(config);
    assert.deepEqual(result.mods[other], previous);
    if (platform === 'android') {
      assert.equal(typeof result.mods.android.projectBuildGradle, 'function');
      assert.equal(typeof result.mods.android.dangerous, 'function');
    } else {
      assert.equal(typeof result.mods.ios.dangerous, 'function');
      assert.equal(typeof result.mods.ios.xcodeproj, 'function');
    }
  }
});
