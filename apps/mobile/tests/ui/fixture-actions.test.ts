import test from 'node:test';
import assert from 'node:assert/strict';
import {FixtureActionRouter} from '../../src/components/fixture-actions.ts';

test('controlled state actions require one active scope and a mounted accepting handler', async () => {
  const router = new FixtureActionRouter();
  await assert.rejects(router.dispatch({kind: 'select-list'}), /disabled/);
  assert.throws(() => router.subscribe('library', () => true), /isolated/);
  const close = router.activate('file:///fixture-scope');
  assert.throws(() => router.activate('other-scope'), /already active/);
  const stop = router.subscribe('library', action => action.kind === 'select-list');
  assert.throws(() => router.subscribe('library', () => true), /Duplicate/);
  assert.equal(await router.dispatch({kind: 'select-list', list: 'rss'}), 'library');
  await assert.rejects(router.dispatch({kind: 'native-back'}), /no mounted handler/);
  stop();
  await assert.rejects(router.dispatch({kind: 'select-list'}), /no mounted handler/);
  close();
  await assert.rejects(router.dispatch({kind: 'select-list'}), /disabled/);
});

test('held actions cannot finish in a replacement case or invoke its handlers', async () => {
  const router = new FixtureActionRouter();
  const close = router.activate('first');
  let release!: (handled: boolean) => void;
  router.subscribe('held', () => new Promise<boolean>(resolve => {release = resolve;}));
  const pending = router.dispatch({kind: 'open-comment'});
  close();
  const closeNext = router.activate('second');
  let invoked = false;
  router.subscribe('second-reader', () => {invoked = true; return true;});
  release(false);
  await assert.rejects(pending, /scope was replaced/);
  assert.equal(invoked, false);
  assert.equal(await router.dispatch({kind: 'open-comment'}), 'second-reader');
  closeNext();
});
