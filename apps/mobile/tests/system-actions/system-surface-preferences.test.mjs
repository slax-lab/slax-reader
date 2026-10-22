import test from 'node:test';
import assert from 'node:assert/strict';
import {systemSurfaceCapabilities, systemSurfacePreferences} from '../../src/settings/system-surface-preferences.ts';

test('loaded new preferences enable discovery and donations without writing storage', () => {
  const settings = {};
  assert.deepEqual(systemSurfacePreferences(settings), {discovery: true, donations: true});
  assert.deepEqual(settings, {});
});

test('persisted opt-outs remain independent and survive default resolution', () => {
  const settings = {system_discovery_enabled: false, system_donations_enabled: false};
  assert.deepEqual(systemSurfacePreferences(settings), {discovery: false, donations: false});
  assert.deepEqual(systemSurfacePreferences({system_discovery_enabled: false}), {discovery: false, donations: true});
  assert.deepEqual(systemSurfacePreferences({system_donations_enabled: false}), {discovery: true, donations: false});
  assert.deepEqual(settings, {system_discovery_enabled: false, system_donations_enabled: false});
});

test('unloaded or unadmitted preferences cannot publish default-enabled metadata', () => {
  assert.deepEqual(systemSurfacePreferences(null), {discovery: false, donations: false});
  assert.deepEqual(systemSurfacePreferences({system_discovery_enabled: false, system_donations_enabled: false}), {discovery: false, donations: false});
});

test('capabilities preserve donation on iOS 16.4/17 while Spotlight waits for iOS 18', () => {
  for (const version of ['16.4', '17.0', '17.6']) assert.deepEqual(systemSurfaceCapabilities('ios', version, true), {intents: true, donations: true, discovery: false});
  for (const version of [18, '26.5', '27.1']) assert.deepEqual(systemSurfaceCapabilities('ios', version, true), {intents: true, donations: true, discovery: true});
  for (const args of [['ios', '16.3', true], ['ios', '27.1', false], ['android', 37, true]]) assert.deepEqual(systemSurfaceCapabilities(...args), {intents: false, donations: false, discovery: false});
  const preferences = {system_discovery_enabled: false, system_donations_enabled: false};
  systemSurfaceCapabilities('ios', '17.6', true);
  assert.deepEqual(systemSurfacePreferences(preferences), {discovery: false, donations: false});
});
