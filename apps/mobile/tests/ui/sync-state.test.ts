import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceSyncState} from '../../src/components/sync-state.ts';

test('source network/connected priority suppresses stale transfer/error indicators', () => {
  const combined = {connected: true, connecting: true, downloading: true, uploading: true, downloadProgress: null, downloadError: new Error('Server failure')};
  assert.equal(sourceSyncState(combined, false).kind, 'offline');
  assert.equal(sourceSyncState(combined, true).kind, 'connected');
  assert.deepEqual(sourceSyncState({...combined, connected: false, downloadProgress: {downloadedOperations: 2, totalOperations: 4}}, true), {kind: 'downloading', progress: 0.5});
  assert.equal(sourceSyncState({...combined, connected: false, downloading: false}, true).kind, 'uploading');
  assert.equal(sourceSyncState({...combined, connected: false, downloading: false, uploading: false}, true).kind, 'connecting');
});
test('missing native status, zero totals and network exception shapes match the source fallback', () => {
  assert.equal(sourceSyncState(undefined, true).kind, 'connecting');
  const sync = {connected: false, connecting: false, downloading: true, uploading: false, downloadProgress: {downloadedOperations: 20, totalOperations: 0}};
  assert.deepEqual(sourceSyncState(sync, true), {kind: 'downloading', progress: 0});
  assert.equal(sourceSyncState({...sync, downloading: false, downloadError: new Error('NSURLErrorDomain -1009')}, true).kind, 'offline');
  assert.equal(sourceSyncState({...sync, downloading: false, downloadError: new Error('Unauthorized')}, true).kind, 'error');
});
