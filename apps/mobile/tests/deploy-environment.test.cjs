const {test} = require('node:test');
const assert = require('node:assert/strict');
const {copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {loadMobileEnvironment} = require('../tooling/deploy-environment.cjs');

function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'slax-mobile-deploy-')));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  function put(relative, value, mode) {
    const filename = path.join(root, relative);
    mkdirSync(path.dirname(filename), {recursive: true});
    writeFileSync(filename, value, mode ? {mode} : undefined);
    return filename;
  }
  return {root, put, load: processEnvironment => loadMobileEnvironment({root, processEnvironment: processEnvironment ?? {}})};
}

test('default build files resolve without parsing opaque Firebase or signing contents', t => {
  const f = fixture(t);
  const defaults = {
    SLAX_MOBILE_FIREBASE_IOS_CONFIG: 'ios/GoogleService-Info.plist',
    SLAX_MOBILE_FIREBASE_ANDROID_CONFIG: 'android/google-services.json',
    SLAX_ANDROID_KEYSTORE_PATH: 'android/slax-reader.release.jks',
  };
  for (const relative of Object.values(defaults)) f.put(`deploy/mobile/${relative}`, Buffer.from([0, 255, 42]));
  const result = f.load();
  for (const [name, relative] of Object.entries(defaults)) assert.equal(result.environment[name], path.join(f.root, 'deploy/mobile', relative));
  assert.equal(result.environment.SLAX_ANDROID_KEYSTORE_PASSWORD, undefined);
  assert.deepEqual(result.files, []);
});

test('local credentials support quoted values and process overrides without mutating the caller', t => {
  const f = fixture(t);
  f.put('deploy/mobile/.env', 'SLAX_ANDROID_KEYSTORE_PASSWORD="local # password"\nSLAX_ANDROID_KEY_ALIAS=old-key\nSLAX_ANDROID_KEY_PASSWORD=local-key-password\nSLAX_MOBILE_VERSION=1.2.3\n');
  const inherited = {SLAX_ANDROID_KEY_ALIAS: 'selected-key', SLAX_ANDROID_KEY_PASSWORD: '', SHELL_ONLY: 'present'};
  const result = f.load(inherited);
  assert.equal(result.environment.SLAX_ANDROID_KEYSTORE_PASSWORD, 'local # password');
  assert.equal(result.environment.SLAX_ANDROID_KEY_ALIAS, 'selected-key');
  assert.equal(result.environment.SLAX_ANDROID_KEY_PASSWORD, '');
  assert.equal(result.environment.SLAX_MOBILE_VERSION, '1.2.3');
  assert.equal(result.environment.SHELL_ONLY, 'present');
  assert.deepEqual(result.files, ['deploy/mobile/.env']);
  assert.deepEqual(inherited, {SLAX_ANDROID_KEY_ALIAS: 'selected-key', SLAX_ANDROID_KEY_PASSWORD: '', SHELL_ONLY: 'present'});
});

test('explicit paths resolve against the repository root and shell paths override file paths', t => {
  const f = fixture(t);
  f.put('deploy/mobile/.env', 'SLAX_ANDROID_KEYSTORE_PATH=deploy/mobile/android/custom.jks\nSLAX_MOBILE_FIREBASE_IOS_CONFIG=deploy/mobile/ios/custom.plist\n');
  f.put('deploy/mobile/android/slax-reader.release.jks', 'opaque default');
  const result = f.load({SLAX_ANDROID_KEYSTORE_PATH: 'ci/publisher.jks'});
  assert.equal(result.environment.SLAX_ANDROID_KEYSTORE_PATH, path.join(f.root, 'ci/publisher.jks'));
  assert.equal(result.environment.SLAX_MOBILE_FIREBASE_IOS_CONFIG, path.join(f.root, 'deploy/mobile/ios/custom.plist'));
});

test('fixtures and offline checks do not read malformed local configuration or discover operator files', t => {
  const f = fixture(t);
  f.put('deploy/mobile/.env', 'PASSWORD="private-unclosed-value');
  f.put('deploy/mobile/android/slax-reader.release.jks', 'opaque');
  for (const env of [{EXPO_PUBLIC_SLAX_UI_FIXTURE: 'reader-pdf'}, {EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE: '1'}, {SLAX_MOBILE_NO_LOCAL_CONFIG: '1'}]) {
    assert.deepEqual(f.load(env).environment, env);
  }
  assert.deepEqual(loadMobileEnvironment({root: f.root, processEnvironment: {}, readLocal: false}).environment, {});
});

test('invalid local files fail with their path and no configuration contents', t => {
  const f = fixture(t);
  for (const value of ['PASSWORD="private-unclosed-value', 'BAD-NAME=private-value', 'PASSWORD="private-value" trailing', 'PASSWORD=private\0value']) {
    f.put('deploy/mobile/.env', value);
    assert.throws(() => f.load(), error => /Invalid mobile environment file:/.test(error.message) && !/private/.test(error.message.replace(f.root, '')));
  }
  rmSync(path.join(f.root, 'deploy/mobile/.env'));
  mkdirSync(path.join(f.root, 'deploy/mobile/android/slax-reader.release.jks'), {recursive: true});
  assert.throws(() => f.load(), /regular file: deploy\/mobile\/android\/slax-reader.release.jks/);
});

test('unconfigured mobile does not read other applications or legacy operator locations', t => {
  const f = fixture(t);
  f.put('deploy/local/.env', 'MOBILE_MUST_NOT_READ="unclosed');
  f.put('apps/mobile/.env', 'MOBILE_MUST_NOT_READ="unclosed');
  f.put('.local/mobile-operator/20261012/slax-reader.release.jks', 'old opaque key');
  assert.deepEqual(f.load().environment, {});
});

function nativeFixture(t) {
  const f = fixture(t);
  for (const file of ['native-build.mjs', 'deploy-environment.cjs']) {
    const target = path.join(f.root, 'apps/mobile/tooling', file);
    mkdirSync(path.dirname(target), {recursive: true});
    copyFileSync(path.join(__dirname, '../tooling', file), target);
  }
  f.put('apps/mobile/android/app/build.gradle', 'versionCode 12\nversionName "1.2.3"\n// Slax release signing: operator-managed environment only.\n');
  f.put('deploy/mobile/android/slax-reader.release.jks', 'synthetic test key');
  f.put('apps/mobile/android/gradlew', `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),key:process.env.SLAX_ANDROID_KEYSTORE_PATH,alias:process.env.SLAX_ANDROID_KEY_ALIAS,password:process.env.SLAX_ANDROID_KEYSTORE_PASSWORD,keyPassword:process.env.SLAX_ANDROID_KEY_PASSWORD}));\n`, 0o755);
  f.run = () => spawnSync(process.execPath, [path.join(f.root, 'apps/mobile/tooling/native-build.mjs'), 'android', '--release', 'bundleRelease'], {cwd: tmpdir(), env: {PATH: process.env.PATH}, encoding: 'utf8', timeout: 10000});
  return f;
}

test('direct Android release passes discovered signing inputs to the build process from any cwd', {skip: process.platform === 'win32'}, t => {
  const f = nativeFixture(t);
  f.put('deploy/mobile/.env', 'SLAX_MOBILE_VERSION=1.2.3\nSLAX_MOBILE_BUILD_NUMBER=12\nSLAX_MOBILE_PREVIOUS_BUILD_NUMBER=11\nSLAX_ANDROID_KEYSTORE_PASSWORD=synthetic-store\nSLAX_ANDROID_KEY_ALIAS=synthetic-alias\nSLAX_ANDROID_KEY_PASSWORD=synthetic-key\n');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {args: ['assembleRelease', 'bundleRelease'], key: path.join(f.root, 'deploy/mobile/android/slax-reader.release.jks'), alias: 'synthetic-alias', password: 'synthetic-store', keyPassword: 'synthetic-key'});
});

test('missing original signing credentials stop a release before starting Gradle', {skip: process.platform === 'win32'}, t => {
  const f = nativeFixture(t);
  f.put('deploy/mobile/.env', 'SLAX_MOBILE_VERSION=1.2.3\nSLAX_MOBILE_BUILD_NUMBER=12\nSLAX_MOBILE_PREVIOUS_BUILD_NUMBER=11\n');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deploy\/mobile\/\.env/);
  assert.equal(result.stdout, '');
});

test('root mobile dispatcher loads native inputs, isolates offline commands and leaves help available', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t);
  const repo = path.resolve(__dirname, '../../..');
  for (const file of ['mobile.mjs', 'pnpm-command.mjs']) {
    const target = path.join(f.root, 'tooling', file);
    mkdirSync(path.dirname(target), {recursive: true});
    copyFileSync(path.join(repo, 'tooling', file), target);
  }
  const helper = path.join(f.root, 'apps/mobile/tooling/deploy-environment.cjs');
  mkdirSync(path.dirname(helper), {recursive: true});
  copyFileSync(path.join(__dirname, '../tooling/deploy-environment.cjs'), helper);
  f.put('apps/mobile/package.json', JSON.stringify({name: '@fixture/mobile', scripts: {prebuild: 'fixture', check: 'fixture'}}));
  f.put('bin/pnpm', `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),version:process.env.SLAX_MOBILE_VERSION,skip:process.env.SLAX_MOBILE_NO_LOCAL_CONFIG,noDotenv:process.env.EXPO_NO_DOTENV}));\n`, 0o755);
  const run = args => spawnSync(process.execPath, [path.join(f.root, 'tooling/mobile.mjs'), ...args], {cwd: tmpdir(), env: {PATH: path.join(f.root, 'bin') + path.delimiter + process.env.PATH}, encoding: 'utf8', timeout: 10000});
  f.put('deploy/mobile/.env', 'SLAX_MOBILE_VERSION=1.2.3\n');
  const configured = run(['--', 'prebuild', '--platform', 'android']);
  assert.equal(configured.status, 0, configured.stderr);
  assert.deepEqual(JSON.parse(configured.stdout), {args: ['--filter', '@fixture/mobile', 'run', 'prebuild', '--platform', 'android'], version: '1.2.3', noDotenv: '1'});
  f.put('deploy/mobile/.env', 'PASSWORD="private-unclosed-value');
  const offline = run(['check']);
  assert.equal(offline.status, 0, offline.stderr);
  assert.equal(JSON.parse(offline.stdout).skip, '1');
  assert.equal(JSON.parse(offline.stdout).version, undefined);
  assert.equal(run(['help']).status, 0);
  const malformed = run(['prebuild']);
  assert.equal(malformed.status, 1);
  assert.doesNotMatch(malformed.stderr, /private-unclosed-value/);
});
