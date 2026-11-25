import test from 'node:test';
import assert from 'node:assert/strict';
import {loadComponent} from '../reader/parity-host.mjs';

async function install({dev}) {
  const calls = [], records = [];
  let handler, tracker;
  const ErrorUtils = {getGlobalHandler: () => (error, fatal) => calls.push(['previous', error.message, fatal]), setGlobalHandler: next => {handler = next;}};
  const HermesInternal = {enablePromiseRejectionTracker: options => {tracker = options;}};
  const native = await loadComponent('../../src/telemetry/native.ts', {}, {__DEV__: dev, ErrorUtils, HermesInternal, globalThis: {ErrorUtils, HermesInternal}});
  native.setActiveErrorLog({capture: (kind, error) => {records.push([kind, error?.message ?? String(error)]); return 'fp';}, flush: async () => {}});
  native.installNativeErrorHandlers();
  native.installNativeErrorHandlers();
  return {native, calls, records, handler: () => handler, tracker: () => tracker};
}

test('the global handler records the error and still calls the previous React Native handler', async () => {
  const f = await install({dev: false});
  f.handler()(new Error('boom'), true);
  assert.deepEqual(f.records, [['error', 'boom']]);
  assert.deepEqual(f.calls, [['previous', 'boom', true]]);
});

test('release builds track unhandled rejections; development keeps React Native tracking', async () => {
  const release = await install({dev: false});
  release.tracker().onUnhandled(1, new Error('rejected'));
  assert.deepEqual(release.records, [['unhandledrejection', 'rejected']]);
  const development = await install({dev: true});
  assert.equal(development.tracker(), undefined);
});

test('a render error is recorded and a throwing collector never escapes', async () => {
  const f = await install({dev: false});
  f.native.reportRenderError(new Error('render'));
  assert.deepEqual(f.records, [['render', 'render']]);
  f.native.setActiveErrorLog({capture: () => {throw new Error('collector broke');}, flush: async () => {}});
  assert.doesNotThrow(() => f.handler()(new Error('again'), false));
  assert.deepEqual(f.calls.at(-1), ['previous', 'again', false]);
});
