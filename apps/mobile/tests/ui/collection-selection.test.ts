import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CollectionSelection} from '../../src/screens/collection-selection.ts';

const collections = [{id: 'new', hasNew: true}, {id: 'read', hasNew: false}];
test('selection marks new content once per change and rejects unknown sources', () => {
  const selection = new CollectionSelection();
  assert.equal(selection.select('missing', collections), null);
  assert.deepEqual(selection.select('new', collections), {id: 'new', markRead: 'new'});
  assert.equal(selection.select('new', collections), null);
  assert.deepEqual(selection.select('read', collections), {id: 'read', markRead: null});
  assert.deepEqual(selection.select(null, collections), {id: null, markRead: null});
});
test('subscription removal returns to own feed, while ordinary updates retain selection', () => {
  const selection = new CollectionSelection();
  selection.select('new', collections);
  assert.equal(selection.reconcile([{id: 'new', hasNew: false}]), null);
  assert.deepEqual(selection.reconcile([{id: 'read', hasNew: false}]), {id: null, markRead: null});
  assert.equal(selection.reconcile([]), null);
  assert.deepEqual(selection.select('new', collections), {id: 'new', markRead: 'new'});
});
