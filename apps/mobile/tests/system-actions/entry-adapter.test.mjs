import test from 'node:test';
import assert from 'node:assert/strict';
import {loadComponent} from '../reader/parity-host.mjs';

const {createSystemEntryRouter} = await loadComponent('../../src/system-actions/adapters.ts', {});

const SURFACE_STATE_KEY = '_slax_system_surface_state_v1';
function runtime(state, userId = 'u') {
  const lookups = [], values = {[SURFACE_STATE_KEY]: JSON.stringify(state)};
  return {lookups, value: {
    preferences: {read: async () => values, update: async update => update(values)},
    sessions: {getSnapshot: () => ({status: 'authenticated', session: {userId, token: 't', refreshedAt: 0}})},
    api: {options: {baseUrl: 'https://api.test'}}, getNativeResourceOwner: () => 'g1', getUpgradeSnapshot: () => ({status: 'ready'}), credentials: {getSnapshot: () => ({status: 'ready'})},
    getRepositories: () => ({getSystemBookmark: async id => {lookups.push(id); return {id, title: 'T', aliasTitle: '', url: 'https://example.com', status: 'success', archiveStatus: 0, createdAt: 'now'};}}),
  }};
}
const lookup = async (state, id, userId) => {
  const r = runtime(state, userId), entry = createSystemEntryRouter(r.value, {donateCatalogOpen: async () => {}}, async () => {});
  const bookmark = await entry.router['ports'].getBookmark(id);
  return {bookmark, lookups: r.lookups};
};

test('Spotlight entry resolves primary-key ids directly and already-donated legacy ids through the owner map', async () => {
  const owner = JSON.stringify(['u', 'https://api.test']), legacy = `b-${'c'.repeat(64)}`;
  assert.deepEqual((await lookup({}, 'b-bookmark-1')).lookups, ['bookmark-1']);
  assert.deepEqual((await lookup({catalogOwner: owner, catalogIdMap: {[legacy]: 'bookmark-2'}}, legacy)).lookups, ['bookmark-2']);
  assert.deepEqual((await lookup({donationOwner: owner, catalogIdMap: {[legacy]: 'bookmark-2'}}, legacy)).lookups, ['bookmark-2']);
  const foreign = await lookup({catalogOwner: JSON.stringify(['other', 'https://api.test']), catalogIdMap: {[legacy]: 'bookmark-2'}}, legacy);
  assert.equal(foreign.bookmark, null); assert.deepEqual(foreign.lookups, [], 'Another account map is never used');
  const unmapped = await lookup({catalogOwner: owner, catalogIdMap: {}}, legacy);
  assert.equal(unmapped.bookmark, null); assert.deepEqual(unmapped.lookups, []);
});
