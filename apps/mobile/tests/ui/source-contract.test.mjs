import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// These fields come from the checksum-pinned source DAOs and serializable DTOs.
// This checks shared synthetic inputs before either native adapter is built.
const bundle = JSON.parse(readFileSync(new URL('../../fixtures/scenarios.json', import.meta.url)));
const requiredBookmarkStrings = ['uuid', 'title', 'byline', 'status', 'host_url', 'site_name', 'target_url', 'description', 'content_icon', 'published_at', 'content_cover'];
function strings(value, keys, context) {
  for (const key of keys) assert.equal(typeof value[key], 'string', `${context}.${key} is required by the pinned source contract`);
}
test('every shared fixture supplies original user, bookmark, annotation and local-cache contracts', () => {
  for (const [name, scenario] of Object.entries(bundle.scenarios)) {
    const database = scenario.payload.database;
    for (const user of database.sr_user) strings(user, ['id', 'email', 'lang', 'timezone'], name + '.user');
    for (const row of [...database.sr_user_bookmark, ...database.sr_collection_bookmark]) {
      const metadata = JSON.parse(row.metadata);
      assert.ok(Array.isArray(metadata.tags)); strings(metadata.bookmark, requiredBookmarkStrings, name + '.bookmark');
      assert.ok(Number.isInteger(metadata.bookmark.content_word_count));
    }
    for (const row of database.sr_bookmark_comment) {
      strings(row, ['id', 'user_bookmark_uuid', 'source', 'comment', 'approx_source', 'content', 'created_at', 'metadata'], name + '.comment');
      assert.ok([1, 2, 3, 4, 5].includes(row.type)); assert.ok([0, 1].includes(row.is_deleted));
      for (const content of JSON.parse(row.content)) strings(content, ['type', 'text'], name + '.quotedContent');
      for (const source of JSON.parse(row.source)) {
        assert.ok(['text', 'image'].includes(source.type)); strings(source, ['path'], name + '.markSource');
        if (source.type === 'text') assert.ok(Number.isInteger(source.start) && Number.isInteger(source.end));
      }
    }
    for (const row of database.ps_data_local__local_bookmark_info) {
      const value = JSON.parse(row.data); strings(value, ['id'], name + '.local'); assert.ok(Number.isInteger(value.is_downloaded));
      if (value.mark_users) for (const profile of JSON.parse(value.mark_users)) strings(profile, ['uuid', 'nick_name', 'avatar'], name + '.profile');
    }
  }
});
test('shared RSS success envelopes contain source-required subscription and entry fields', () => {
  for (const [name, scenario] of Object.entries(bundle.scenarios)) for (const route of scenario.payload.api) {
    if (route.status !== 200 || route.method !== 'GET') continue;
    const data = route.json?.data;
    if (route.path === '/v1/rss/subscriptions') for (const value of data.items) strings(value, ['id', 'feed_url', 'title', 'next_fetch_at', 'next_allowed_at'], name + '.rssSubscription');
    if (route.path === '/v1/rss/entries') for (const value of data.items) strings(value, ['id', 'subscription_id', 'source_title', 'title', 'summary', 'first_seen_at'], name + '.rssEntry');
    if (/^\/v1\/rss\/entries\/[^/]+$/.test(route.path)) strings(data, ['id', 'subscription_id', 'source_title', 'title', 'summary', 'first_seen_at'], name + '.rssDetail');
  }
});
