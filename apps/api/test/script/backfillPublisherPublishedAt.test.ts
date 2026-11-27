import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Client } from 'pg'
import { backfill, classify, parseCorrections, publisherIds } from '../../script/backfill-publisher-published-at'

const wrong = '2026-11-18T07:15:41.000Z'
const right = '2013-08-15T00:00:00.000Z'

describe('publisher publication time backfill input', () => {
  test('normalizes times and rejects malformed or duplicate entries', () => {
    const uuid = '0ccf9cd2-0b10-44d7-9bab-dc288696af09'
    expect(parseCorrections(JSON.stringify([{ uuid, ours: '2013-08-15T00:00:00+00:00', reader: '2026-11-18T07:15:41Z', coll: 'x' }]))).toEqual([
      { uuid, ours: right, reader: wrong }
    ])
    expect(() => parseCorrections('{}')).toThrow('JSON array')
    expect(() => parseCorrections(JSON.stringify([{ uuid: 'nope', ours: right, reader: wrong }]))).toThrow('index 0')
    expect(() => parseCorrections(JSON.stringify([{ uuid, ours: 'x', reader: wrong }]))).toThrow('index 0')
    expect(() =>
      parseCorrections(
        JSON.stringify([
          { uuid, ours: right, reader: wrong },
          { uuid, ours: right, reader: wrong }
        ])
      )
    ).toThrow('Duplicate')
    expect(publisherIds(' 3, 7 ,x')).toEqual([3, 7])
    expect(() => publisherIds('')).toThrow('PUBLISHER_USER_IDS')
  })

  test('classifies ownership and audit state before any write', () => {
    const c = { uuid: 'u', ours: right, reader: wrong }
    expect(classify(c, undefined, [7])).toBe('not_found')
    expect(classify(c, { id: 1, private_user: 0, user_id: 7, published_at: wrong }, [7])).toBe('not_publisher_owned')
    expect(classify(c, { id: 1, private_user: 8, user_id: 8, published_at: wrong }, [7])).toBe('not_publisher_owned')
    expect(classify(c, { id: 1, private_user: 7, user_id: 7, published_at: right }, [7])).toBe('already_correct')
    expect(classify(c, { id: 1, private_user: 7, user_id: 7, published_at: '2026-11-20T00:00:00.000Z' }, [7])).toBe('changed_since_audit')
    expect(classify(c, { id: 1, private_user: 7, user_id: 7, published_at: wrong }, [7])).toBe('would_update')
  })
})

const url = process.env.FORK_TEST_DATABASE_URL
describe.runIf(!!url)('publisher publication time backfill against PostgreSQL', () => {
  const client = new Client({ connectionString: url })
  const users: number[] = []
  const bookmarks: number[] = []
  const rows: Record<string, { uuid: string; id: number }> = {}

  const seed = async (name: string, owner: () => number, holder: () => number, published: string) => {
    const result = await client.query<{ id: number }>(
      `INSERT INTO sr_bookmark (title, target_url, private_user, status, content_key, content_md_key, created_at, updated_at, published_at)
       VALUES ('t', $1, $2, 'success', 'b.html', 'b.txt', now(), now(), ($3::timestamptz AT TIME ZONE 'UTC')) RETURNING id`,
      [`https://backfill.test/${crypto.randomUUID()}`, owner(), published]
    )
    bookmarks.push(result.rows[0].id)
    const relation = await client.query<{ uuid: string }>(`INSERT INTO sr_user_bookmark (user_id, bookmark_id, updated_at) VALUES ($1, $2, now()) RETURNING uuid::text`, [
      holder(),
      result.rows[0].id
    ])
    rows[name] = { uuid: relation.rows[0].uuid, id: result.rows[0].id }
  }
  const stored = async (name: string) =>
    (await client.query<{ p: string }>(`SELECT to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') p FROM sr_bookmark WHERE id = $1`, [rows[name].id])).rows[0].p

  beforeAll(async () => {
    await client.connect()
    for (const name of ['publisher', 'other']) {
      const user = await client.query<{ id: number }>(`INSERT INTO sr_user (email, name, created_at, last_login_at) VALUES ($1, $2, now(), now()) RETURNING id`, [
        `${crypto.randomUUID()}@backfill.test`,
        name
      ])
      users.push(user.rows[0].id)
    }
    await seed(
      'match',
      () => users[0],
      () => users[0],
      wrong
    )
    await seed(
      'correct',
      () => users[0],
      () => users[0],
      right
    )
    await seed(
      'changed',
      () => users[0],
      () => users[0],
      '2026-11-20T00:00:00.000Z'
    )
    await seed(
      'foreign',
      () => users[1],
      () => users[1],
      wrong
    )
    await seed(
      'shared',
      () => 0,
      () => users[0],
      wrong
    )
  })
  afterAll(async () => {
    await client.query('DELETE FROM sr_user_bookmark WHERE bookmark_id = ANY($1)', [bookmarks])
    await client.query('DELETE FROM sr_bookmark WHERE id = ANY($1)', [bookmarks])
    await client.query('DELETE FROM sr_user WHERE id = ANY($1)', [users])
    await client.end()
  })

  test('a dry run writes nothing, and --apply writes only the matching publisher row', async () => {
    const corrections = [...Object.values(rows).map(r => ({ uuid: r.uuid, ours: right, reader: wrong })), { uuid: crypto.randomUUID(), ours: right, reader: wrong }]
    const dry = await backfill(client, corrections, [users[0]], false)
    expect(dry.counts).toEqual({ updated: 0, would_update: 1, already_correct: 1, changed_since_audit: 1, not_publisher_owned: 2, not_found: 1 })
    expect(await stored('match')).toBe(wrong)

    const applied = await backfill(client, corrections, [users[0]], true)
    expect(applied.counts).toEqual({ updated: 1, would_update: 0, already_correct: 1, changed_since_audit: 1, not_publisher_owned: 2, not_found: 1 })
    expect(await stored('match')).toBe(right)
    expect(await stored('changed')).toBe('2026-11-20T00:00:00.000Z')
    expect(await stored('foreign')).toBe(wrong)
    expect(await stored('shared')).toBe(wrong)

    const again = await backfill(client, corrections, [users[0]], true)
    expect(again.counts.updated).toBe(0)
    expect(again.counts.already_correct).toBe(2)
  })
})
