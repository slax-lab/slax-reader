import test from 'node:test';
import assert from 'node:assert/strict';
import {React, loadComponent} from '../reader/parity-host.mjs';

test('Live Activity adapter starts only on request and uses the public local update/end API', async () => {
  let definition, instance;
  const calls = [];
  const module = await loadComponent('../../src/widgets/reading-activity.tsx', {
    react: React,
    'expo-widgets': {createLiveActivity(name, layout) {definition = {name, layout}; return {
      start(payload, url, staleDate) {calls.push(['start', payload, url, staleDate]); instance = makeActivity(); return instance;},
      getInstances() {return instance ? [instance] : [];},
    };}},
    '@expo/ui/swift-ui': {Text: props => props, VStack: props => props},
  });
  const factory = module.createReadingActivityFactory();
  assert.equal(definition.name, 'SlaxReadingSessionActivity');
  const port = module.createReadingActivityPort(factory, () => true);
  assert.equal(calls.length, 0, 'Factory registration does not create an activity');
  const payload = {id: 'session', readCount: 0, goal: 5, startedAt: 1, staleAt: 60_001, expiresAt: 3_600_001, stale: false};
  assert.equal(await port.start(payload), 'activity-1');
  assert.equal(calls[0][0], 'start'); assert.equal(calls[0][3].getTime(), payload.staleAt);
  const layout = definition.layout({...payload, readCount: 2}, {isStale: true});
  assert.equal(layout.banner.props.children[0].props.children, 'Reading session may be out of date');
  await port.update('activity-1', {...payload, readCount: 2, staleAt: 120_001});
  assert.equal(calls.at(-1)[0], 'update'); assert.equal(calls.at(-1)[2].getTime(), 120_001);
  await port.end('activity-1', payload);
  assert.equal(calls.at(-1)[0], 'end'); assert.equal(calls.at(-1)[1], 'immediate');

  function makeActivity() {
    return {getId: () => 'activity-1', update: (...args) => {calls.push(['update', ...args]);}, end: (...args) => {calls.push(['end', ...args]);}};
  }
});
