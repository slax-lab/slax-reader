import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = fileURLToPath(new URL('./legacy-reset-ui/', import.meta.url));
const source = readFileSync(path.join(directory, 'metro.cjs'), 'utf8');
function load(env) {
  const module = {exports: {}};
  vm.runInNewContext(source, {module, __dirname: directory, process: {env}, require: name => name === 'node:path' ? path : {getDefaultConfig: () => ({resolver: {}})}});
  return module.exports;
}
test('normal-screen reset harness refuses non-fixture or non-loopback configuration', () => {
  assert.throws(() => load({}), /Isolated reset UI/);
  assert.throws(() => load({EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE: '1', EXPO_PUBLIC_SLAX_API_URL: 'https://api-reader.slax.com'}), /Isolated reset UI/);
});
test('normal-screen reset harness keeps production runtime and replaces only entry and external provider', () => {
  const config = load({EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE: '1', EXPO_PUBLIC_SLAX_API_URL: 'http://127.0.0.1:8198'});
  const root = path.resolve(directory, '../../..');
  const resolve = filePath => config.resolver.resolveRequest({resolveRequest: () => ({type: 'sourceFile', filePath})}, 'input', 'ios');
  assert.equal(resolve(path.join(root, 'index.ts')).filePath, path.join(directory, 'entry.ts'));
  assert.equal(resolve(path.join(root, 'src/auth/providers.ts')).filePath, path.join(directory, 'provider.ts'));
  for (const file of ['src/App.tsx', 'src/runtime.tsx', 'src/data/runtime.ts', 'src/domain/session.ts', 'src/screens/LoginScreen.tsx']) assert.equal(resolve(path.join(root, file)).filePath, path.join(root, file));
  assert.match(readFileSync(path.join(directory, 'entry.ts'), 'utf8'), /!__DEV__/);
  assert.match(readFileSync(path.join(directory, 'provider.ts'), 'utf8'), /!__DEV__/);
});
