import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, withNativeHost, nativeBoundary} from '../reader/parity-host.mjs';

test('row download status never flashes a clock for a fast cache and holds a readable state', nativeBoundary, async () => withNativeHost(async host => {
  let now = 0, nextId = 0;
  const timers = new Map();
  const fakeSetTimeout = (callback, delay) => {const id = ++nextId; timers.set(id, {at: now + delay, callback}); return id;};
  const fakeClearTimeout = id => timers.delete(id);
  const advance = milliseconds => {
    now += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= now) {timers.delete(id); timer.callback();}
  };
  class Clock extends Date {static now() {return now;}}
  const icons = [];
  const {BookmarkStatusIcon, bookmarkDownloadStatus, bookmarkStatusIcon} = await loadComponent('../../src/components/BookmarkStatusIcon.tsx', {
    react: React, 'react-native': host.native, '../theme': {mobileColors: {background: '#FFFFFF'}},
    './SourceUI': {SourceIcon: props => {icons.push(props.name); return null;}},
  }, {setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, Date: Clock});
  assert.equal(bookmarkDownloadStatus(0), 'NONE'); assert.equal(bookmarkDownloadStatus(1), 'DOWNLOADING');
  assert.equal(bookmarkDownloadStatus(2), 'COMPLETED'); assert.equal(bookmarkDownloadStatus(3), 'FAILED');
  assert.equal(bookmarkStatusIcon('DOWNLOADING', 'starred'), 'ic_cell_starred');
  assert.equal(bookmarkStatusIcon('DOWNLOADING', 'archived'), 'ic_cell_archived');
  let status = 'NONE';
  const render = () => host.render(React.createElement(BookmarkStatusIcon, {status, sort: 'inbox', label: 'Article'}));
  await render();
  assert.equal(icons.at(-1), 'ic_cell_internet_uncached');
  status = 'DOWNLOADING'; await render();
  assert.equal(icons.at(-1), 'ic_cell_internet_uncached', 'A short download does not flash the clock');
  status = 'COMPLETED'; await render();
  assert.equal(icons.at(-1), 'ic_cell_internet', 'A download shorter than the delay goes directly to cached');
  await act(async () => advance(1000));
  assert.equal(icons.at(-1), 'ic_cell_internet');

  status = 'DOWNLOADING'; await render();
  await act(async () => advance(249));
  assert.equal(icons.at(-1), 'ic_cell_internet', 'The clock waits for the dwell delay');
  await act(async () => advance(1));
  assert.equal(icons.at(-1), 'ic_cell_internet_downloading');
  status = 'COMPLETED'; await render();
  await act(async () => advance(449));
  assert.equal(icons.at(-1), 'ic_cell_internet_downloading', 'A briefly shown clock stays readable');
  await act(async () => advance(1));
  assert.equal(icons.at(-1), 'ic_cell_internet');

  status = 'DOWNLOADING'; await render();
  await act(async () => advance(100));
  const shown = icons.length;
  await host.render(null);
  assert.equal(timers.size, 0, 'Unmount clears a pending status timer');
  await act(async () => advance(1000));
  assert.equal(icons.length, shown);
}));
