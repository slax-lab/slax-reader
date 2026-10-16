import test from 'node:test';
import assert from 'node:assert/strict';
import {selectFixtureInspector} from '../../tooling/fixture-control-contract.mjs';
const target = {appId: 'com.slax.reader.uifixture', deviceName: 'owned-device', webSocketDebuggerUrl: 'ws://127.0.0.1:8083/inspector/debug?device=owned&page=1'};
test('fixture inspector selects only the unique isolated app on the named device', () => {
  const production = {...target, appId: 'com.slax.reader'};
  assert.equal(selectFixtureInspector([production, {...target, deviceName: 'other'}, target], 'android', 'owned-device').appId, target.appId);
  assert.throws(() => selectFixtureInspector([production], 'android', 'owned-device'));
  assert.throws(() => selectFixtureInspector([target, target], 'android', 'owned-device'));
  assert.throws(() => selectFixtureInspector([target], 'ios', 'owned-device'));
});
test('fixture inspector rejects external, authenticated, or unexpected control endpoints', () => {
  for (const endpoint of ['ws://example.test:8083/inspector/debug', 'wss://127.0.0.1:8083/inspector/debug', 'ws://127.0.0.1:8084/inspector/debug', 'ws://127.0.0.1:8083/control', 'ws://user:password@127.0.0.1:8083/inspector/debug', 'ws://127.0.0.1:8083/inspector/debug#other']) assert.throws(() => selectFixtureInspector([{...target, webSocketDebuggerUrl: endpoint}], 'android', 'owned-device'));
});
