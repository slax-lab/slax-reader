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

test('production builds check the production channel on launch without waiting, bound to the native version', () => {
  const config = appConfig({});
  assert.deepEqual(config.runtimeVersion, {policy: 'nativeVersion'});
  assert.deepEqual(config.updates, {enabled: true, url: `https://u.expo.dev/${config.extra.eas.projectId}`, checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0, requestHeaders: {'expo-channel-name': 'production'}});
  assert.equal(appConfig({EXPO_PUBLIC_SLAX_API_URL: 'https://api-reader.slax.com'}).updates.enabled, true);
  assert.equal(JSON.parse(readFileSync(new URL('../../eas.json', import.meta.url), 'utf8')).build.production.channel, 'production');
});

test('fixture builds and builds with non-production origins never receive production updates', () => {
  for (const env of [{EXPO_PUBLIC_SLAX_UI_FIXTURE: 'library'}, {EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE: '1'}, {EXPO_PUBLIC_SLAX_API_URL: 'https://reader-api.slax.dev'},
    {EXPO_PUBLIC_SLAX_BETA_API_URL: 'https://reader-api.slax.dev'}, {EXPO_PUBLIC_SLAX_WEB_URL: 'https://reader.slax.dev'}, {EXPO_PUBLIC_SLAX_WEB_DOMAIN: '.slax.dev'}]) {
    assert.deepEqual(appConfig(env).updates, {enabled: false}, JSON.stringify(env));
  }
});
