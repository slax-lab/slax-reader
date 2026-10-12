import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const rules = readFileSync(new URL('../../../../deploy/local/powersync-local/sync_rules.yaml', import.meta.url), 'utf8')
const stream = (name: string) => rules.match(new RegExp(`\\n  ${name}:([\\s\\S]*?)(?=\\n  [a-zA-Z_][\\w]*:|$)`))?.[1] || ''

describe('PowerSync collection rules', () => {
  test('all identity sources exclude tombstones, including explicit collection subscriptions', () => {
    expect(rules).toMatch(/WHERE uuid = auth\.user_id\(\)\s+AND deleted_at IS NULL/)
    const collections = stream('subscribed_collections')
    expect(collections.match(/authenticated_user\.deleted_at IS NULL/g)).toHaveLength(2)
    expect(collections).toContain('owner.deleted_at IS NULL')
    const comments = stream('collection_bookmark_comment')
    expect(comments).toContain('authenticated_user.uuid = auth.user_id()')
    expect(comments).toContain('authenticated_user.deleted_at IS NULL')
    expect(comments).toContain('owner.deleted_at IS NULL')
  })

  test('keeps personal sync version-neutral and gates collection auto-sync to v2', () => {
    const personalData = stream('user_data_v1')
    const subscribedCollections = stream('subscribed_collections')

    expect(personalData).not.toContain("connection.parameter('schema_version')")
    expect(rules.match(/connection\.parameter\('schema_version'\) = '2'/g)).toHaveLength(5)
    expect(subscribedCollections.match(/connection\.parameter\('schema_version'\) = '2'/g)).toHaveLength(5)
    expect(subscribedCollections).toContain('authenticated_user.uuid = auth.user_id()')
    expect(subscribedCollections).toContain('user_id IN current_user_id')
    expect(rules).not.toContain('collection_user_id')
  })

  test('syncs tag ownership and recency to clients', () => {
    const personalData = stream('user_data_v1')

    expect(personalData).toContain('SELECT tag_name, display, source, last_used_at, created_at, uuid AS id')
    expect(personalData).toContain('FROM sr_user_tag')
  })

  test('do not use dynamic time predicates in sync rules', () => {
    expect(rules).not.toMatch(/CURRENT_TIMESTAMP|now\(\)|subscription_end_time\s*>/i)
  })

  test('syncs collection articles into the local sr_collection_bookmark table alias', () => {
    const subscribedCollections = stream('subscribed_collections')

    expect(subscribedCollections).toContain('FROM sr_user_collection AS sr_sharer_setting')
    expect(subscribedCollections).toContain('subscriber.is_active = true')
    expect(subscribedCollections).toContain('FROM sr_user_bookmark AS sr_collection_bookmark')
    expect(subscribedCollections).toContain('sr_collection_bookmark.user_id IN open_collection_owner_ids')
  })

  test('syncs a read-only default global setting per Collection owner', () => {
    const subscribedCollections = stream('subscribed_collections')

    expect(subscribedCollections).toContain('CAST(sr_sharer_setting.owner_id AS TEXT) AS id')
    expect(subscribedCollections).toContain('0 AS allow_highlight')
    expect(subscribedCollections).toContain('1 AS show_highlight')
    expect(subscribedCollections).toContain('1 AS allow_access')
    expect(subscribedCollections).toContain('sr_sharer_setting.owner_id IN open_collection_owner_ids')
  })

  test('syncs collection detail comments by owner and article policy without subscription gate', () => {
    const collectionComments = stream('collection_bookmark_comment')

    expect(collectionComments).toContain("ifnull(json_extract(bookmark.metadata, '$.share.is_enable'), 1) = 1")
    expect(collectionComments).toContain("ifnull(json_extract(bookmark.metadata, '$.share.show_line'), 1) = 1")
    expect(collectionComments).toContain("ifnull(json_extract(bookmark.metadata, '$.share.show_comment'), 1) = 1")
    expect(collectionComments).toContain("bookmark.user_id = CAST(subscription.parameter('owner_id') AS INTEGER)")
    expect(collectionComments).toContain('INNER JOIN sr_user_collection AS collection')
    expect(collectionComments).not.toContain('subscriber.is_active = true')
    // 关闭态合集不再下发评论；订阅门控仍然不加（见用例名 without subscription gate）
    expect(collectionComments).toContain('collection.status = 1')
    expect(collectionComments).not.toContain('bookmark.user_id IN open_collection_owner_ids')
    expect(rules).not.toMatch(/share\.id\s+IS\s+NULL\s+OR/i)
    expect(rules).not.toMatch(/OR\s+\(share\.is_enable/i)
    expect(rules).not.toContain('LEFT JOIN sr_bookmark_share')
    expect(rules).not.toContain('NOT EXISTS')
    expect(rules).not.toContain('bookmark.uuid NOT IN')
    expect(rules).not.toContain('sr_bookmark_share AS share')
  })

  test('splits personal and collection bookmark comment streams without OR authorization', () => {
    expect(rules).toContain('bookmark_comment:')
    expect(rules).toContain('AND bookmark.user_id IN current_user_id')
    expect(rules).toContain('collection_bookmark_comment:')
    expect(rules).toContain("AND bookmark.user_id = CAST(subscription.parameter('owner_id') AS INTEGER)")
    expect(rules).not.toMatch(/bookmark\\.user_id IN current_user_id[\\s\\S]*\\bOR\\b[\\s\\S]*bookmark\\.user_id IN open_collection_owner_ids/)
  })

  test('does not alias the bookmark comment source table in the joined streams', () => {
    expect(rules.match(/FROM sr_bookmark_comment\n      INNER JOIN sr_user_bookmark AS bookmark/g)?.length).toBeGreaterThanOrEqual(2)
    expect(rules).not.toContain('FROM sr_bookmark_comment AS')
  })

  test('filters collection articles and reuses owner buckets for active Collection stats', () => {
    const subscribedCollections = stream('subscribed_collections')

    expect(subscribedCollections).toContain("ifnull(json_extract(sr_collection_bookmark.metadata, '$.share.is_enable'), 1) = 1")
    expect(subscribedCollections).toContain('FROM sr_user_bookmark_stats')
    expect(subscribedCollections).not.toContain('FROM sr_user_bookmark_stats AS')
    expect(subscribedCollections).toContain('WHERE sr_user_bookmark_stats.owner_id IN open_collection_owner_ids')
    expect(subscribedCollections).toContain('sr_user_bookmark_stats.collection_id IS NOT NULL')
    expect(subscribedCollections).not.toMatch(/FROM sr_user_bookmark_stats[\s\S]*?INNER JOIN sr_user_bookmark/)
    expect(rules).not.toContain('collection_policy')
  })
})
