import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {loadComponent} from '../reader/parity-host.mjs';
import {NetworkAvailability, type NetworkAvailabilityState, type NetworkObservation} from '../../src/data/network-availability.ts';

const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {promise, resolve};};

test('connectivity listener overrides a stale initial read and equivalent events publish once', async () => {
  const read = deferred<NetworkObservation>(), updates: NetworkAvailabilityState[] = [];
  let listener!: (state: NetworkObservation) => void, subscriptions = 0, removals = 0;
  const network = new NetworkAvailability({read: () => read.promise, subscribe(next) {subscriptions++; listener = next; return () => {removals++;};}}, state => updates.push(state));
  network.start(); network.start();
  listener({isConnected: false}); listener({isConnected: false});
  read.resolve({isConnected: true, isInternetReachable: true}); await setImmediate();
  assert.deepEqual(updates, ['offline']); assert.equal(network.getSnapshot(), 'offline'); assert.equal(subscriptions, 1);
  listener({isConnected: true, isInternetReachable: false}); assert.deepEqual(updates, ['offline']);
  listener({isConnected: true}); listener({isConnected: true}); assert.deepEqual(updates, ['offline', 'online']);
  listener({}); assert.equal(network.getSnapshot(), 'online');
  network.stop(); listener({isConnected: false}); assert.equal(updates.length, 2); assert.equal(removals, 1); assert.equal(network.getSnapshot(), 'unknown');
});

test('connectivity refresh and restart fence late reads and old subscription callbacks', async () => {
  const reads: ReturnType<typeof deferred<NetworkObservation>>[] = [], listeners: ((state: NetworkObservation) => void)[] = [], updates: NetworkAvailabilityState[] = [];
  const network = new NetworkAvailability({read() {const result = deferred<NetworkObservation>(); reads.push(result); return result.promise;}, subscribe(listener) {listeners.push(listener); return () => {};}}, state => updates.push(state));
  network.start(); await setImmediate(); network.refresh(); await setImmediate();
  reads[1].resolve({isConnected: false}); await setImmediate(); reads[0].resolve({isConnected: true}); await setImmediate();
  assert.deepEqual(updates, ['offline']);
  network.refresh(); await setImmediate(); network.stop(); network.start(); await setImmediate();
  listeners[0]({isConnected: true}); reads[2].resolve({isConnected: true}); await setImmediate(); assert.equal(network.getSnapshot(), 'unknown');
  reads[3].resolve({isConnected: false}); await setImmediate(); assert.deepEqual(updates, ['offline', 'offline']); network.stop();
});

test('unavailable connectivity observation does not falsely declare offline or block startup', async () => {
  const network = new NetworkAvailability({read: async () => {throw new Error('unavailable');}, subscribe() {throw new Error('unavailable');}}, () => assert.fail('Missing observations must not invent state'));
  network.start(); await setImmediate(); assert.equal(network.getSnapshot(), 'unknown'); network.stop();
});

test('native network adapter owns the Expo subscription and reads only connectivity state', async () => {
  let callback!: (state: NetworkObservation) => void, reads = 0, removed = 0;
  const {nativeNetwork} = await loadComponent('../../src/data/native-network.ts', {'expo-network': {
    getNetworkStateAsync: async () => {reads++; return {isConnected: false};},
    addNetworkStateListener(listener: (state: NetworkObservation) => void) {callback = listener; return {remove() {removed++;}};},
  }});
  const values: NetworkObservation[] = [], stop = nativeNetwork.subscribe((value: NetworkObservation) => values.push(value));
  callback({isConnected: true}); assert.deepEqual(values, [{isConnected: true}]);
  assert.deepEqual(await nativeNetwork.read(), {isConnected: false}); assert.equal(reads, 1); stop(); assert.equal(removed, 1);
});
