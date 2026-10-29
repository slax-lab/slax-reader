import { computed, effectScope, ref } from 'vue'

import { flushPromises } from '@vue/test-utils'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let sqlite: DatabaseSync
const revision = ref(0)
vi.mock('@powersync/vue', () => ({
  useQuery: (sql: { value: string }) => ({
    data: computed(() => {
      revision.value
      return sqlite.prepare(sql.value).all()
    }),
    isLoading: ref(false),
    error: ref(undefined),
    refresh: vi.fn(async () => {}),
  }),
}))

import {
  useLocalNewsletterPresence,
  useNewsletterLocalState,
} from '../../../app/composables/newsletter/useNewsletterLocalState'

const scopes: ReturnType<typeof effectScope>[] = []
const create = (active = ref(true)) => {
  const scope = effectScope()
  scopes.push(scope)
  const database = {
    getAll: async (sql: string) => sqlite.prepare(sql).all(),
    syncStream: () => ({ subscribe: () => new Promise(() => {}) }),
  }
  return scope.run(() => ({
    presence: useLocalNewsletterPresence(database as never, active, ref(1)),
    newsletter: useNewsletterLocalState(
      database as never,
      active,
      ref(1),
      ref('')
    ),
  }))!
}
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE sr_newsletter_feed (id TEXT PRIMARY KEY, source_key TEXT, sender TEXT, sender_name TEXT, title TEXT, excerpt TEXT, published_at TEXT, received_at TEXT);
    CREATE TABLE sr_user_bookmark (id TEXT PRIMARY KEY, deleted_at TEXT, metadata TEXT);
    INSERT INTO sr_newsletter_feed VALUES
      ('9','sender','sender@example.com','Old sender','Nine','Excerpt',NULL,'2026-10-20 00:00:00'),
      ('10','sender','sender@example.com','New sender','Ten','Excerpt','2026-10-01 00:00:00','2026-10-20 00:00:00'),
      ('9223372036854775806','sender','sender@example.com','Sender','Large','Excerpt',NULL,'2026-10-20 00:00:00'),
      ('9223372036854775807','sender','sender@example.com','Latest sender','Largest','Excerpt',NULL,'2026-10-20 00:00:00');`)
  revision.value++
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  sqlite.close()
})

test('the local query keeps BIGINT identifiers as text and orders equal receipt times numerically', () => {
  const { newsletter } = create()
  expect(newsletter.entries.value.map((row) => row.id)).toEqual([
    'newsletter:9223372036854775807',
    'newsletter:9223372036854775806',
    'newsletter:10',
    'newsletter:9',
  ])
  expect(newsletter.entries.value[2]).toMatchObject({
    published_at: '2026-10-01T00:00:00.000Z',
    sort_at: '2026-10-20T00:00:00.000Z',
  })
  expect(newsletter.subscriptions.value).toEqual([
    {
      id: 'newsletter:sender',
      kind: 'newsletter',
      title: 'Latest sender',
      sender: 'sender@example.com',
    },
  ])
})

test('local saved state resolves private message URLs and ignores deleted bookmarks and ordinary URLs', () => {
  const insert = sqlite.prepare('INSERT INTO sr_user_bookmark VALUES (?, ?, ?)')
  insert.run(
    'saved',
    null,
    JSON.stringify({
      bookmark: { target_url: 'slax-newsletter://message/10' },
    })
  )
  insert.run(
    'deleted',
    '2026-10-20',
    JSON.stringify({ bookmark: { target_url: 'slax-newsletter://message/9' } })
  )
  insert.run(
    'web',
    null,
    JSON.stringify({ bookmark: { target_url: 'https://example.com/9' } })
  )
  const { newsletter } = create()
  expect(
    newsletter.entries.value
      .filter((row) => row.bookmark_user_uuid)
      .map((row) => [row.id, row.bookmark_user_uuid])
  ).toEqual([['newsletter:10', 'saved']])
  sqlite.exec("DELETE FROM sr_user_bookmark WHERE id = 'saved'")
  revision.value++
  expect(
    newsletter.entries.value.every((row) => row.bookmark_user_uuid === null)
  ).toBe(true)
})

test('inactive queries expose neither cached presence nor source metadata', async () => {
  const active = ref(false),
    { newsletter, presence } = create(active)
  expect(presence.value).toBe(false)
  expect(newsletter.entries.value).toEqual([])
  expect(newsletter.subscriptions.value).toEqual([])
  active.value = true
  await flushPromises()
  expect(presence.value).toBe(true)
  expect(newsletter.entries.value).toHaveLength(4)
  active.value = false
  expect(newsletter.entries.value).toEqual([])
  expect(presence.value).toBe(false)
})
