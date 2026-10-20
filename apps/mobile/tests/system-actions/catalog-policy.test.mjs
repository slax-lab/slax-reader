import test from 'node:test';
import assert from 'node:assert/strict';
import {systemBookmarkId, toBookmarkEntities} from '../../src/system-actions/catalog-policy.ts';

const row = (id, overrides = {}) => ({id, title: 'Article title', aliasTitle: '', url: 'https://example.com/private/path?token=secret', status: 'success', createdAt: '2026-10-20', archiveStatus: 0, ...overrides});

test('system catalog keeps at most 100 recent eligible title/host/opaque-id fields and strips full URLs', () => {
  const result = toBookmarkEntities(Array.from({length: 120}, (_, index) => row(`id-${index}`)));
  assert.equal(result.length, 100); assert.equal(result[0].id, systemBookmarkId('', 'id-0'));
  assert.deepEqual(result[0], {id: systemBookmarkId('', 'id-0'), title: 'Article title', subtitle: 'example.com', synonyms: [], metadata: {sourceHost: 'example.com'}});
  assert.equal(JSON.stringify(result).includes('/private/path'), false); assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('system catalog excludes archived, invalid, credential-bearing and untitled items', () => {
  const rows = [row('archived', {archiveStatus: 1}), row('javascript', {url: 'javascript:alert(1)'}), row('credentials', {url: 'https://u:p@example.com'}), row('untitled', {title: ''}), row('valid')];
  assert.deepEqual(toBookmarkEntities(rows).map(item => item.id), [systemBookmarkId('', 'valid')]);
  assert.notEqual(systemBookmarkId('owner-a', 'same-id'), systemBookmarkId('owner-b', 'same-id'));
});
