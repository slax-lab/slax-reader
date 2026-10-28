import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSystemBookmarkId, systemBookmarkId, toBookmarkEntities} from '../../src/system-actions/catalog-policy.ts';

const row = (id, overrides = {}) => ({id, title: 'Article title', aliasTitle: '', url: 'https://example.com/private/path?token=secret', status: 'success', createdAt: '2026-10-20', archiveStatus: 0, ...overrides});

test('system catalog keeps at most 500 recent eligible title/host/primary-key fields and strips full URLs', () => {
  const result = toBookmarkEntities(Array.from({length: 520}, (_, index) => row(`id-${index}`)));
  assert.equal(result.length, 500); assert.equal(result[0].id, 'b-id-0');
  assert.deepEqual(result[0], {id: 'b-id-0', title: 'Article title', subtitle: 'example.com', synonyms: [], metadata: {sourceHost: 'example.com'}});
  assert.equal(JSON.stringify(result).includes('/private/path'), false); assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('system catalog excludes archived, invalid, credential-bearing and untitled items', () => {
  const rows = [row('archived', {archiveStatus: 1}), row('javascript', {url: 'javascript:alert(1)'}), row('credentials', {url: 'https://u:p@example.com'}), row('untitled', {title: ''}), row('valid')];
  assert.deepEqual(toBookmarkEntities(rows).map(item => item.id), [systemBookmarkId('valid')]);
});

test('entity ids derive from primary keys without per-row hashing work', () => {
  const rows = Array.from({length: 500}, (_, index) => row(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`));
  const encode = TextEncoder.prototype.encode;
  let encodes = 0; TextEncoder.prototype.encode = function (...args) {encodes++; return encode.apply(this, args);};
  try {
    const entities = toBookmarkEntities(rows);
    assert.equal(entities.length, 500); assert.equal(encodes, 0);
    assert.deepEqual(entities.map(entity => entity.id), rows.map(item => `b-${item.id}`));
  } finally {TextEncoder.prototype.encode = encode;}
});

test('current ids resolve by primary key; legacy hashed ids only through their recorded map entry', () => {
  const legacy = `b-${'a'.repeat(64)}`;
  assert.equal(resolveSystemBookmarkId('b-real-bookmark'), 'real-bookmark');
  assert.equal(resolveSystemBookmarkId(legacy), null, 'An unmapped legacy hash is never treated as a bookmark key');
  assert.equal(resolveSystemBookmarkId(legacy, {[legacy]: 'real-bookmark'}), 'real-bookmark');
  for (const invalid of ['real-bookmark', 'b-', 'b-../escape', 'b-a b', `b-${'x'.repeat(129)}`]) assert.equal(resolveSystemBookmarkId(invalid), null, invalid);
});
