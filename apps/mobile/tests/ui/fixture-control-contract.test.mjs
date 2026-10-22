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
test('fixture inspector selects a validated task-specific app identity', () => {
  const taskTarget = {...target, appId: 'app.slax.reader.uifixture.rssacceptance'};
  assert.equal(selectFixtureInspector([taskTarget], 'ios', 'owned-device', 'rssacceptance').appId, taskTarget.appId);
  const alternatePort = {...taskTarget, webSocketDebuggerUrl: target.webSocketDebuggerUrl.replace(':8083', ':8084')};
  assert.deepEqual(selectFixtureInspector([alternatePort], 'ios', 'owned-device', 'rssacceptance', 8084), {appId: taskTarget.appId, endpoint: alternatePort.webSocketDebuggerUrl});
  for (const port of [0, 1023, 65536, 8084.5, NaN]) assert.throws(() => selectFixtureInspector([taskTarget], 'ios', 'owned-device', 'rssacceptance', port), /local TCP port/);
  assert.throws(() => selectFixtureInspector([target], 'ios', 'owned-device', 'rssacceptance'));
  assert.throws(() => selectFixtureInspector([taskTarget], 'ios', 'owned-device', '../other'));
});
test('fixture inspector rejects external, authenticated, or unexpected control endpoints', () => {
  for (const endpoint of ['ws://example.test:8083/inspector/debug', 'wss://127.0.0.1:8083/inspector/debug', 'ws://127.0.0.1:8084/inspector/debug', 'ws://127.0.0.1:8083/control', 'ws://user:password@127.0.0.1:8083/inspector/debug', 'ws://127.0.0.1:8083/inspector/debug#other']) assert.throws(() => selectFixtureInspector([{...target, webSocketDebuggerUrl: endpoint}], 'android', 'owned-device'));
});
