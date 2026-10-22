import test from 'node:test';
import assert from 'node:assert/strict';
import {FeatureState} from '../../src/reader/state/feature-state.ts';

test('feature stores publish independently and coalesce hidden changes', () => {
  const draft = new FeatureState(''), overview = new FeatureState('');
  let drafts = 0, streams = 0;
  const unsubscribe = draft.subscribe(() => drafts++);
  overview.subscribe(() => streams++);
  draft.set('one'); draft.set('one'); assert.equal(drafts, 1); assert.equal(streams, 0);
  overview.setVisible(false); overview.set('a'); overview.set(value => `${value}b`);
  assert.equal(streams, 0); assert.equal(overview.getSnapshot(), 'ab');
  overview.setVisible(true); assert.equal(streams, 1);
  overview.setVisible(true); assert.equal(streams, 1);
  unsubscribe(); draft.set('two'); assert.equal(drafts, 1);
});
