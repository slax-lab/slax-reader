import test from 'node:test';
import assert from 'node:assert/strict';
import {systemSurfacePreferences} from '../../src/settings/system-surface-preferences.ts';
import {createSystemSurfacesController} from '../../src/system-actions/adapters.ts';

test('loaded new preferences enable discovery and donations without changing widget consent', () => {
  const settings = {};
  assert.deepEqual(systemSurfacePreferences(settings), {discovery: true, donations: true});
  assert.deepEqual(settings, {});
  assert.equal(settings.widget_titles_enabled, undefined);
  assert.equal(settings.widget_count_enabled, undefined);
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

test('default-enabled runtime waits for authenticated admitted credentials and respects loaded opt-out', async () => {
  let session = {status: 'unauthenticated'}, upgrade = {status: 'ready'}, credentials = {status: 'ready'}, generation = 'owner-a', watches = 0;
  let values = {};
  const runtime = {
    preferences: {async read() {return values;}, async update(edit) {edit(values);}},
    sessions: {getSnapshot: () => session},
    getNativeResourceOwner: () => generation,
    getUpgradeSnapshot: () => upgrade,
    credentials: {getSnapshot: () => credentials},
    api: {options: {baseUrl: 'https://api.test'}},
    getRepositories: () => ({watchSystemCatalog() {watches++; return () => {};}}),
  };
  const controller = createSystemSurfacesController(runtime, {
    async setEntityCatalogAsync() {}, async deleteDonationsAsync() {return [];}, async donateIntentAsync() {return null;},
  });
  controller.activate();
  await controller.reconcile(true, true);
  assert.equal(watches, 0);
  session = {status: 'authenticated', session: {userId: 'a'}};
  for (const blocked of ['upgrade', 'credentials', 'owner']) {
    upgrade = {status: blocked === 'upgrade' ? 'loading' : 'ready'};
    credentials = {status: blocked === 'credentials' ? 'refreshing' : 'ready'};
    generation = blocked === 'owner' ? null : 'owner-a';
    await controller.reconcile(true, true);
    assert.equal(watches, 0);
  }
  generation = 'owner-a';
  values = {system_discovery_enabled: false, system_donations_enabled: false};
  const optedOut = systemSurfacePreferences(values);
  await controller.reconcile(optedOut.discovery, optedOut.donations);
  assert.equal(watches, 0);
  values = {};
  const defaults = systemSurfacePreferences(values);
  await controller.reconcile(defaults.discovery, defaults.donations);
  assert.equal(watches, 1);
  controller.dispose();
});
