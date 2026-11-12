import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function adapter(native) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../../src/native/passkeys.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, JSON, require(name) {
    if (name === 'expo') return {requireNativeModule: name => {assert.equal(name, 'SlaxPlatform'); return native;}};
    if (name === '../utils/abort') return {throwIfAborted: signal => signal.throwIfAborted()};
    assert.fail(`Unexpected adapter dependency ${name}`);
  }});
  return exports.nativePasskeys;
}

for (const [operation, method] of [['register', 'createPasskey'], ['authenticate', 'authenticatePasskey']]) test(`native ${operation} serializes WebAuthn options exactly once and returns native JSON`, async () => {
  const options = {challenge: 'base64url', rpId: 'reader.test'}, credential = {id: 'id', rawId: 'id', type: 'public-key', response: {signature: 'signature'}};
  let calls = 0;
  const native = adapter({[method]: async value => {calls++; assert.equal(value, JSON.stringify(options)); return JSON.stringify(credential);}, cancelPasskey: async () => assert.fail('completed requests must not be cancelled')});
  const cancellation = new AbortController();
  assert.deepEqual(await native[operation](options, cancellation.signal), credential);
  cancellation.abort();
  assert.equal(calls, 1);
});

test('native user cancellation remains a quiet empty result', async () => {
  const native = adapter({authenticatePasskey: async () => null});
  assert.equal(await native.authenticate({}, new AbortController().signal), null);
});

test('aborted ceremony cancels the native owner and discards a late credential', async () => {
  let complete, cancelled = 0;
  const held = new Promise(resolve => {complete = resolve;});
  const native = adapter({authenticatePasskey: () => held, cancelPasskey: async () => {cancelled++;}});
  const cancellation = new AbortController();
  const pending = native.authenticate({}, cancellation.signal);
  cancellation.abort();
  complete(JSON.stringify({id: 'retired'}));
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(cancelled, 1);
});
