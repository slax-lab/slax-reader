const {test} = require('node:test');
const assert = require('node:assert/strict');
const {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {configureDevelopmentMetro, developmentCommand, developmentSession} = require('../tooling/development-metro.cjs');

const token = ['header', Buffer.from(JSON.stringify({id: '28260'})).toString('base64url'), 'signature'].join('.');
const origins = {
  SLAX_MOBILE_DEV_API_URL: 'http://192.168.9.185:8787',
  SLAX_MOBILE_DEV_POWERSYNC_URL: 'http://192.168.9.185:18080',
  SLAX_MOBILE_DEV_TOKEN: token,
};

test('an absent or partial development session keeps defaults or fails clearly', () => {
  assert.equal(developmentSession({}), null);
  assert.throws(() => developmentSession({SLAX_MOBILE_DEV_API_URL: origins.SLAX_MOBILE_DEV_API_URL}), /Set SLAX_MOBILE_DEV_POWERSYNC_URL in deploy\/mobile\/\.env/);
  assert.throws(() => developmentSession({...origins, SLAX_MOBILE_DEV_TOKEN: ''}), /Set SLAX_MOBILE_DEV_TOKEN in deploy\/mobile\/\.env/);
});

test('a complete session derives the web origin and the account user id', () => {
  const session = developmentSession(origins);
  assert.deepEqual({...session, token: undefined}, {
    apiUrl: 'http://192.168.9.185:8787',
    powerSyncUrl: 'http://192.168.9.185:18080',
    webUrl: 'http://192.168.9.185:3000',
    webDomain: '192.168.9.185',
    token: undefined,
    userId: '28260',
  });
  assert.equal(session.token, token);
  const explicit = developmentSession({...origins, SLAX_MOBILE_DEV_WEB_URL: 'http://192.168.9.185:3000/'});
  assert.equal(explicit.webUrl, 'http://192.168.9.185:3000');
  assert.equal(explicit.webDomain, '192.168.9.185');
});

test('development sessions reject release origins, malformed tokens and unsafe URLs', () => {
  for (const value of ['https://api-reader.slax.com', 'https://api-reader-beta.slax.com']) {
    assert.throws(() => developmentSession({...origins, SLAX_MOBILE_DEV_API_URL: value}), /development API origin/);
  }
  for (const value of ['not-a-jwt', 'a.b.c', `a.${Buffer.from('{}').toString('base64url')}.c`]) {
    assert.throws(() => developmentSession({...origins, SLAX_MOBILE_DEV_TOKEN: value}), /SLAX_MOBILE_DEV_TOKEN/);
  }
  assert.throws(() => developmentSession({...origins, SLAX_MOBILE_DEV_WEB_URL: 'ftp://192.168.9.185'}), /HTTP\(S\)/);
  assert.throws(() => developmentSession({...origins, SLAX_MOBILE_DEV_API_URL: 'http://user:pass@192.168.9.185:8787'}), /without credentials/);
});

function fixture(t, environment = origins) {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-mobile-metro-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const appRoot = path.join(root, 'apps/mobile');
  for (const file of ['src/runtime.tsx', 'src/config.ts', 'src/development/runtime.ts', 'src/development/config.ts', 'src/development/session.ts']) {
    const filename = path.join(appRoot, file);
    mkdirSync(path.dirname(filename), {recursive: true});
    writeFileSync(filename, '');
  }
  mkdirSync(path.join(root, 'deploy/mobile'), {recursive: true});
  writeFileSync(path.join(root, 'deploy/mobile/.env'), Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\n'));
  return {root, appRoot};
}

function metroConfig(appRoot) {
  return {
    watchFolders: [],
    resolver: {
      resolveRequest: (context, name) => {
        const base = path.resolve(path.dirname(context.originModulePath), name);
        return {type: 'sourceFile', filePath: /\.[a-z]+$/.test(base) ? base : `${base}.ts`};
      },
    },
  };
}

function configure(f, commandLine, relay = () => {}) {
  const config = metroConfig(f.appRoot);
  return {config, result: configureDevelopmentMetro(config, f.appRoot, {root: f.root, processEnvironment: {}, commandLine, relay})};
}

test('Metro activates the session only for development-serving commands', () => {
  for (const command of ['start', 'run:ios', 'run:android']) assert.equal(developmentCommand(['node', 'expo', command, '--device']), true, command);
  for (const command of ['export', 'prebuild', 'build:ios', 'run:ios --configuration Release', 'run:android --variant release', 'run:ios --release']) {
    assert.equal(developmentCommand(['node', 'expo', ...command.split(' ')]), false, command);
  }
});

test('Metro keeps its default configuration when the session is unspecified or the command is not a development start', t => {
  for (const [environment, commandLine] of [[{}, ['node', 'expo', 'start']], [origins, ['node', 'expo', 'export']], [origins, ['node', 'expo', 'run:ios', '--configuration', 'Release']]]) {
    const f = fixture(t, environment);
    const {config, result} = configure(f, commandLine, () => assert.fail('relay must not start'));
    assert.equal(result, config);
    assert.deepEqual(config.watchFolders, []);
    assert.equal(existsSync(path.join(f.root, '.local/mobile-development')), false);
  }
});

test('a complete session redirects config, data and session modules and starts the LAN relays once', t => {
  const f = fixture(t);
  const relayed = [];
  const {config, result} = configure(f, ['node', 'expo', 'start', '--dev-client'], session => relayed.push(session));
  assert.equal(result, config);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].apiUrl, origins.SLAX_MOBILE_DEV_API_URL);
  assert.equal(relayed[0].powerSyncUrl, origins.SLAX_MOBILE_DEV_POWERSYNC_URL);

  const generated = path.join(f.root, '.local/mobile-development/session.cjs');
  assert.ok(existsSync(generated));
  assert.match(readFileSync(generated, 'utf8'), /developmentSession/);
  assert.match(readFileSync(generated, 'utf8'), /28260/);
  if (process.platform !== 'win32') assert.equal(statSync(generated).mode & 0o777, 0o600);
  assert.ok(config.watchFolders.includes(path.dirname(generated)));

  const resolve = (origin, name) => config.resolver.resolveRequest({originModulePath: origin}, name, 'ios');
  assert.equal(resolve(path.join(f.appRoot, 'src/runtime.tsx'), './data').filePath, path.join(f.appRoot, 'src/development/runtime.ts'));
  assert.equal(resolve(path.join(f.appRoot, 'src/other.ts'), './config').filePath, path.join(f.appRoot, 'src/development/config.ts'));
  assert.equal(resolve(path.join(f.appRoot, 'src/development/runtime.ts'), './session').filePath, generated);
});

test('iOS and Android device runs load the session while their Release variants stay default', t => {
  for (const commandLine of [['node', 'expo', 'run:ios', '--device'], ['node', 'expo', 'run:android', '--variant', 'debug']]) {
    const f = fixture(t);
    const relayed = [];
    const {config, result} = configure(f, commandLine, session => relayed.push(session));
    assert.equal(result, config);
    assert.equal(relayed.length, 1);
    assert.ok(existsSync(path.join(f.root, '.local/mobile-development/session.cjs')));
  }
});
