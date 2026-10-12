import test from 'node:test';
import assert from 'node:assert/strict';
import {changesSql, validateSeed} from './adoption-fixtures/tooling/real-service.mjs';
import {MOBILE_TABLES} from '../../src/data/schema.ts';
import {diffChanges} from '../../src/data/uploader.ts';
import {readVisibleInputs} from './adoption-fixtures/tooling/visible-producer-project.mjs';
import {materializedFixtureValuesMatch} from './native-service-materialization.ts';

test('the real-service SQL boundary quotes values and rejects unrelated tables, columns and operations', () => {
  const sql = changesSql([{table: 'sr_user_tag', id: 'synthetic-tag', op: 'PUT', data: {tag_name: "reader's; DROP TABLE sr_user; --", display: null}, preData: null}]);
  assert.match(sql, /reader''s; DROP TABLE sr_user; --/);
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/);
  for (const change of [
    {table: 'fixture_upload_receipts', id: 'tag', op: 'DELETE'},
    {table: 'local_bookmark_info', id: 'tag', op: 'DELETE'},
    {table: 'sr_user_tag', id: '../real', op: 'DELETE'},
    {table: 'sr_user_tag', id: 'tag', op: 'ALTER', data: {}},
    {table: 'sr_user_tag', id: 'tag', op: 'PATCH', data: {unknown: 'x'}},
    {table: 'sr_user_tag', id: 'tag', op: 'PATCH', data: {user_id: {token: 'not-valid'}}},
  ]) assert.throws(() => changesSql([change]));
});

test('real-service initialization requires all synchronized tables and cannot import local-only metadata', () => {
  const rows = Object.fromEntries(Object.entries(MOBILE_TABLES).filter(([, value]) => !value.options?.localOnly).map(([name]) => [name, []]));
  assert.equal(validateSeed(rows), rows);
  assert.throws(() => validateSeed({...rows, local_bookmark_info: []}));
  assert.throws(() => validateSeed({...rows, sr_user_tag: [{id: 'tag', private_extra: 'x'}]}));
  assert.throws(() => validateSeed({...rows, sr_user_tag: [{id: 'tag', display: Number.NaN}]}));
});

test('the actual uploader full-row metadata PATCH is accepted without inventing untransmitted values', () => {
  const input = readVisibleInputs();
  const before = {tags: ['tag-1'], share: input.share, bookmark: input.bookmarkDetails};
  const after = {tags: ['tag-1', 'tag-2'], share: {...input.share, ...input.updatedShare}, bookmark: input.bookmarkDetails};
  const payload = diffChanges({is_starred: 1, starred_at: input.createdAt, metadata: JSON.stringify(after)}, {is_starred: 0, starred_at: null, metadata: JSON.stringify(before)});
  assert.deepEqual(payload.data, {is_starred: '1', starred_at: input.createdAt, 'metadata.tags': '["tag-1","tag-2"]', 'metadata.share.is_enable': 'false'});
  assert.equal(after.share.allow_access, before.share.allow_access);
  const sql = changesSql([{table: 'sr_user_bookmark', id: 'bookmark-1', op: 'PATCH', ...payload}]);
  assert.match(sql, /jsonb_set\(jsonb_set\(metadata::jsonb,'\{tags\}'::text\[\],'\["tag-1","tag-2"\]'::jsonb,false\),'\{share,is_enable\}'::text\[\],'false'::jsonb,false\)/);
  assert.match(sql, /"is_starred"='1'/);
  assert(!sql.includes('allow_access'));
  for (const value of [
    {table: 'sr_user_tag', op: 'PATCH', data: {'metadata.tags': '["tag-1"]'}},
    {table: 'sr_user_bookmark', op: 'PUT', data: {'metadata.tags': '["tag-1"]'}},
    {table: 'sr_user_bookmark', op: 'PATCH', data: {'metadata.tags': '["tag-1"]', metadata: '{}'}},
    {table: 'sr_user_bookmark', op: 'PATCH', data: {'metadata.tags': '["../private"]'}},
    {table: 'sr_user_bookmark', op: 'PATCH', data: {'metadata.tags': '{"tag":"tag-1"}'}},
    {table: 'sr_user_bookmark', op: 'PATCH', data: {'metadata.share.is_enable': '"false"'}},
    {table: 'sr_user_bookmark', op: 'PATCH', data: {'metadata.share.allow_access': '0'}},
    {table: 'sr_user_bookmark', op: 'PATCH', data: {'metadata.share.show_line': 'false'}},
  ]) assert.throws(() => changesSql([{id: 'bookmark-1', ...value}]));
});

test('materialized metadata comparison allows PostgreSQL JSON formatting but rejects any changed value', () => {
  const expected = {id: 'bookmark-1', is_starred: '1', deleted_at: null, metadata: '{"tags":["tag-1","tag-2"],"share":{"is_enable":false,"allow_access":1},"future":{"keep":true}}'};
  const actual = {...expected, is_starred: 1, metadata: '{ "future": {"keep": true}, "share": {"allow_access": 1, "is_enable": false}, "tags": ["tag-1", "tag-2"] }'};
  assert(materializedFixtureValuesMatch(expected, actual));
  for (const changed of [
    {...actual, metadata: actual.metadata.replace('"allow_access": 1', '"allow_access": 0')},
    {...actual, metadata: actual.metadata.replace('"tag-1", "tag-2"', '"tag-2", "tag-1"')},
    {...actual, metadata: '{}'}, {...actual, metadata: 'not-json'}, {...actual, metadata: null},
    {...actual, is_starred: 0}, {...actual, deleted_at: ''},
  ]) assert(!materializedFixtureValuesMatch(expected, changed));
});
