import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function appConfig(env) {
  const exports = {}, code = ts.transpileModule(readFileSync(new URL('../../app.config.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const boundaries = {'./assets/source-auth-public.json': {default: {}}, './tooling/deploy-environment.cjs': {applyMobileEnvironment() {}},
    './tooling/build-version.cjs': {readBuildVersion: () => ({version: '1.0.25', build: '794'})}};
  vm.runInNewContext(code, {exports, process: {env}, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  return JSON.parse(JSON.stringify(exports.default));
}

const ota = {SLAX_MOBILE_OTA: '1'};

test('EAS production builds check the production channel on launch without waiting, bound to the native version', () => {
  const config = appConfig(ota);
  assert.deepEqual(config.runtimeVersion, {policy: 'nativeVersion'});
  assert.deepEqual(config.updates, {enabled: true, url: `https://u.expo.dev/${config.extra.eas.projectId}`, checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0, requestHeaders: {'expo-channel-name': 'production'}});
  assert.equal(appConfig({...ota, EXPO_PUBLIC_SLAX_API_URL: 'https://api-reader.slax.com'}).updates.enabled, true);
  const production = JSON.parse(readFileSync(new URL('../../eas.json', import.meta.url), 'utf8')).build.production;
  assert.equal(production.channel, 'production');
  assert.equal(production.env.SLAX_MOBILE_OTA, '1');
  assert.match(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts['update:publish'], /^SLAX_MOBILE_OTA=1 .*eas update --channel production /);
});

test('local, fixture and non-production-origin builds never receive production updates', () => {
  assert.deepEqual(appConfig({}).updates, {enabled: false});
  assert.deepEqual(appConfig({SLAX_MOBILE_OTA: 'true'}).updates, {enabled: false});
  for (const env of [{EXPO_PUBLIC_SLAX_UI_FIXTURE: 'library'}, {EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE: '1'}, {EXPO_PUBLIC_SLAX_API_URL: 'https://reader-api.slax.dev'},
    {EXPO_PUBLIC_SLAX_BETA_API_URL: 'https://reader-api.slax.dev'}, {EXPO_PUBLIC_SLAX_WEB_URL: 'https://reader.slax.dev'}, {EXPO_PUBLIC_SLAX_WEB_DOMAIN: '.slax.dev'}]) {
    assert.deepEqual(appConfig({...ota, ...env}).updates, {enabled: false}, JSON.stringify(env));
  }
});
