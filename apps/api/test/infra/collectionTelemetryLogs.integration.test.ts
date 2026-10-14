/**
 * 落库验证（真连本地 PG，BEGIN/ROLLBACK）
 * track 会吞异常，「代码没报错」不能作为通过标准，必须直查 user_logs
 * 开关：RUN_PG_INTEGRATION_TESTS=1
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { LogsService } from '@/domain/logs'
import { LogsRepo } from '@/infra/repository/dbLogs'

const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

/** 把 Prisma 的 $executeRaw 标签模板翻成 pg 的 $1/$2 参数化查询，SQL 文本仍是 dbLogs.ts 里那条 */
function prismaClientAdapter(client: pg.Client) {
  return () =>
    ({
      $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.reduce((acc, part, index) => acc + part + (index < values.length ? `$${index + 1}` : ''), '')
        return client.query(sql, values)
      }
    }) as never
}

describePg('Collection telemetry writes into user_logs', () => {
  let client: pg.Client
  let logs: LogsService
  let marker: string

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.LOGS_DATABASE_URL })
    await client.connect()
    logs = new LogsService(new LogsRepo(prismaClientAdapter(client)))
  })

  afterAll(async () => {
    await client?.end()
  })

  /** 查回本次用例写入的行（用 marker 隔离，避免读到别的用例/存量数据） */
  const rows = async () =>
    (
      await client.query<{
        user_id: number
        event_name: string
        platform: string | null
        extra_data: Record<string, unknown>
      }>(
        `SELECT user_id, event_name::text AS event_name, platform, extra_data
         FROM user_logs
         WHERE extra_data->>'collect_code' = $1
         ORDER BY id`,
        [marker]
      )
    ).rows

  test('四个事件都能写进 user_logs，不被 event_kind 枚举拒绝', async () => {
    await client.query('BEGIN')
    try {
      marker = `telemetrytest${randomUUID().replaceAll('-', '')}`

      await logs.track(0, 'collection_visit', { platform: 'web', collect_code: marker, visitor_id: 'v1', via: 'ssr' })
      await logs.track(0, 'collection_share', { platform: 'web', collect_code: marker, visitor_id: 'v1' })
      await logs.track(101, 'collection_subscribe', { platform: 'web', collect_code: marker, is_new_user: true, signup_age_sec: 30 })
      await logs.track(101, 'collection_unsubscribe', { platform: 'web', collect_code: marker })

      const found = await rows()
      // 枚举缺值时会是 0 行且不报错
      expect(found).toHaveLength(4)
      expect(found.map(r => r.event_name)).toEqual(['collection_visit', 'collection_share', 'collection_subscribe', 'collection_unsubscribe'])
    } finally {
      await client.query('ROLLBACK')
    }
  })

  test('生成列 platform 由 extra_data->>platform 正确填充', async () => {
    await client.query('BEGIN')
    try {
      marker = `telemetrytest${randomUUID().replaceAll('-', '')}`
      await logs.track(0, 'collection_visit', { platform: 'web', collect_code: marker })
      // 无 platform 时生成列应为 NULL
      await logs.track(0, 'collection_share', { collect_code: marker })

      const found = await rows()
      expect(found).toHaveLength(2)
      expect(found[0].platform).toBe('web')
      expect(found[1].platform).toBeNull()
    } finally {
      await client.query('ROLLBACK')
    }
  })

  test('collection_visit（SSR 通道）extra_data 符合 §1 事件矩阵', async () => {
    await client.query('BEGIN')
    try {
      marker = `telemetrytest${randomUUID().replaceAll('-', '')}`
      await logs.track(0, 'collection_visit', {
        platform: 'web',
        collect_code: marker,
        entry_page: 2,
        is_curator: false,
        is_bot: false,
        via: 'ssr',
        duration_ms: 137,
        status_code: 200,
        success: true,
        visitor_id: 'su-abc.1755000000000'
      })

      const [row] = await rows()
      expect(row.user_id).toBe(0)
      expect(row.extra_data).toEqual({
        platform: 'web',
        collect_code: marker,
        entry_page: 2,
        is_curator: false,
        is_bot: false,
        via: 'ssr',
        duration_ms: 137,
        status_code: 200,
        success: true,
        visitor_id: 'su-abc.1755000000000'
      })
      // JSONB 类型保真，勿变成字符串
      expect(typeof row.extra_data.is_bot).toBe('boolean')
      expect(typeof row.extra_data.entry_page).toBe('number')
    } finally {
      await client.query('ROLLBACK')
    }
  })

  test('collection_visit（SPA 通道）无 duration_ms/status_code，via = spa', async () => {
    await client.query('BEGIN')
    try {
      marker = `telemetrytest${randomUUID().replaceAll('-', '')}`
      await logs.track(0, 'collection_visit', { platform: 'web', collect_code: marker, via: 'spa', is_curator: true, entry_page: 1, visitor_id: 'v-spa' })

      const [row] = await rows()
      expect(row.extra_data.via).toBe('spa')
      expect(row.extra_data).not.toHaveProperty('duration_ms')
      expect(row.extra_data).not.toHaveProperty('status_code')
      expect(row.extra_data).not.toHaveProperty('success')
    } finally {
      await client.query('ROLLBACK')
    }
  })

  test('collection_subscribe extra_data 符合矩阵（含 referrer / signup_age_sec）', async () => {
    await client.query('BEGIN')
    try {
      marker = `telemetrytest${randomUUID().replaceAll('-', '')}`
      await logs.track(101, 'collection_subscribe', {
        platform: 'web',
        collect_code: marker,
        signup_age_sec: 45,
        is_new_user: true,
        referrer: 'https://twitter.com/someone'
      })

      const [row] = await rows()
      expect(row.user_id).toBe(101)
      expect(row.extra_data).toEqual({
        platform: 'web',
        collect_code: marker,
        signup_age_sec: 45,
        is_new_user: true,
        referrer: 'https://twitter.com/someone'
      })
      // referrer 不含 query/hash
      expect(String(row.extra_data.referrer)).not.toMatch(/[?#]/)
    } finally {
      await client.query('ROLLBACK')
    }
  })

  test('匿名 user_id = 0 + visitor_id 有值；登录 user_id > 0', async () => {
    await client.query('BEGIN')
    try {
      marker = `telemetrytest${randomUUID().replaceAll('-', '')}`
      await logs.track(0, 'collection_share', { platform: 'web', collect_code: marker, visitor_id: 'guest-visitor-1' })
      await logs.track(2024, 'collection_share', { platform: 'web', collect_code: marker, visitor_id: 'member-visitor-1' })

      const found = await rows()
      expect(found[0].user_id).toBe(0)
      expect(found[0].extra_data.visitor_id).toBe('guest-visitor-1')
      expect(found[1].user_id).toBeGreaterThan(0)

      // 现有去重 SQL 能套用到新事件
      const dedup = await client.query<{ unique_visitors: string; guest_visitors: string; member_visitors: string }>(
        `SELECT COUNT(DISTINCT CASE WHEN user_id > 0 THEN 'u:' || user_id
                                    ELSE 'g:' || (extra_data->>'visitor_id') END) AS unique_visitors,
                COUNT(DISTINCT extra_data->>'visitor_id') FILTER (WHERE user_id = 0) AS guest_visitors,
                COUNT(DISTINCT user_id) FILTER (WHERE user_id > 0) AS member_visitors
         FROM user_logs
         WHERE event_name = 'collection_share' AND extra_data->>'collect_code' = $1`,
        [marker]
      )
      expect(dedup.rows[0]).toEqual({ unique_visitors: '2', guest_visitors: '1', member_visitors: '1' })
    } finally {
      await client.query('ROLLBACK')
    }
  })

  // 护栏：枚举缺值会静默丢数据
  test('未登记的事件名：track 静默失败（不抛异常）且库里无行 —— 印证枚举迁移必须先上线', async () => {
    await client.query('BEGIN')
    try {
      marker = `telemetrytest${randomUUID().replaceAll('-', '')}`
      // 失败 INSERT 会中止事务，用 SAVEPOINT 隔离
      await client.query('SAVEPOINT sp_bad_event')
      // 用不存在的事件名模拟迁移未上线
      await expect(logs.track(0, 'collection_not_a_real_event', { platform: 'web', collect_code: marker })).resolves.toBeUndefined()
      await client.query('ROLLBACK TO SAVEPOINT sp_bad_event')
      expect(await rows()).toHaveLength(0)
    } finally {
      await client.query('ROLLBACK')
    }
  })

  test('ROLLBACK 后库里不留任何 telemetry-test 假数据', async () => {
    const leftovers = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM user_logs WHERE extra_data->>'collect_code' LIKE 'telemetrytest%'`
    )
    expect(leftovers.rows[0].n).toBe('0')
  })
})
