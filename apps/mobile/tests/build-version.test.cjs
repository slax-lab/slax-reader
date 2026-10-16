const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseBuildVersion, readBuildVersion} = require('../tooling/build-version.cjs');

test('package fields produce matching platform versions and the combined display format', () => {
  assert.deepEqual(parseBuildVersion({version: '1.0.25', buildNumber: 754, previousBuildNumber: 753}), {
    version: '1.0.25', build: '754', previous: '753', displayVersion: '1.0.25(754)',
  });
});

test('invalid marketing versions, build codes and non-monotonic bounds are rejected', () => {
  const valid = {version: '1.0.25', buildNumber: 766, previousBuildNumber: 765};
  for (const version of ['1.0.25(766)', '1.0', '01.0.25', '1.0.25-beta', '']) {
    assert.throws(() => parseBuildVersion({...valid, version}), /package.json version/);
  }
  for (const buildNumber of [0, -1, 1.5, '766', 2100000001, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseBuildVersion({...valid, buildNumber}), /package.json buildNumber/);
  }
  for (const previousBuildNumber of [-1, '765', 766, 767, 765.5]) {
    assert.throws(() => parseBuildVersion({...valid, previousBuildNumber}), /exceed previousBuildNumber/);
  }
});

test('the version reader uses the app package manifest', () => {
  const manifest = require('../package.json');
  assert.deepEqual(readBuildVersion(), parseBuildVersion(manifest));
});
