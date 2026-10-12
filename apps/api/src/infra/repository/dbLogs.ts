import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { inject, singleton } from '../../decorators/di'
import { PRISMA_LOGS_CLIENT } from '../../const/symbol'
import type { LazyInstance } from '../../decorators/lazy'

interface OverallMetrics {
  new_bookmarks: number // 新增书签数
  bookmark_users: number // 新增书签用户数
  new_subscriptions: number // 订阅用户数
  archive_users: number // 归档用户数
  activated_users: number // 注册后 24h 内归档至少一篇文章的用户数
  ai_power_users: number // AI 重度用户(发生过多轮 ai_chat 对话，埋点写入时已保证 user 消息 > 1)
  summary_users: number // 使用 summary 的用户数
  overview_users: number // 使用 overview 的用户数
}

interface PlatformMetric {
  platform: string | null
  new_users: number // 新用户数
  active_users: number // 活跃用户数
}

interface VisitOverview {
  total_visits: number // 访问人次(visit 事件总数)
  unique_visitors: number // 去重访问人数(游客按 visitor_id，登录用户按 user_id)
  guest_visitors: number // 去重游客数(user_id = 0)
  member_visitors: number // 去重登录用户数(user_id > 0)
}

interface TopArticleRow {
  uuid: string // sr_user_bookmark.uuid
  guest_uv: number // 访客人数(游客去重, user_id = 0)
  guest_visits: number // 访客次数(游客访问人次)
  member_uv: number // 用户人数(登录用户去重, user_id > 0)
  member_visits: number // 用户次数(登录用户访问人次)
}

interface BookmarkStepRow {
  step_name: string
  bookmarks: number // 进入该 step 的去重书签数
  attempts: number // 该 step 执行次数(含重试)
  success: number // 成功次数
  failed: number // 失败次数
  success_rate: number // 成功率(百分比，保留两位)
}

// 漏斗入口层：bookmark_add 事件
interface BookmarkAddEntryRow {
  attempts: number // 发起次数
  bookmarks: number // 去重书签数（旧数据无 bookmark_id 则为 0）
  users: number // 去重用户数
  success: number // 成功发起次数（旧数据无 status 视为 success）
  failed: number // 失败发起次数
}

interface DailyMetrics {
  day: string
  new_users_ios: number
  new_users_android: number
  new_users_web: number
  active_users_ios: number
  active_users_android: number
  active_users_extension: number
  active_users_web: number
  active_users: number
  new_bookmarks: number
  bookmark_users: number
  new_subscriptions: number
  new_subscriptions_stripe: number
  new_subscriptions_apple_iap: number
  new_subscriptions_trial: number
  new_subscriptions_blogger_trial: number
  subscription_failed: number
  archive_users: number
  activated_users: number
  ai_power_users: number
  summary_users: number
  overview_users: number
}

@singleton()
export class LogsRepo {
  constructor(@inject(PRISMA_LOGS_CLIENT) private client: LazyInstance<HyperdrivePrismaClient>) {}

  async insertLog(userId: number, eventName: string, extraData?: Record<string, unknown>): Promise<void> {
    await this.client().$executeRaw`
      INSERT INTO user_logs (user_id, event_name, extra_data)
      VALUES (${userId}, ${eventName}, ${extraData ? JSON.stringify(extraData) : null})
    `
  }

  async queryOverall(start: Date, end: Date): Promise<OverallMetrics> {
    const rows = await this.client().$transaction(async tx => {
      return tx.$queryRaw<OverallMetrics[]>`
        WITH per_user_event AS (
            SELECT user_id, event_name, COUNT(*) AS cnt, MIN(event_time) AS first_time
            FROM user_logs
            WHERE event_time >= ${start}::timestamptz
              AND event_time <  ${end}::timestamptz
              AND event_name IN ('register', 'bookmark_add', 'subscribe', 'archive', 'ai_summary', 'ai_overview')
              AND NOT (event_name = 'subscribe' AND extra_data->>'status' = 'failed')
              AND NOT (event_name = 'bookmark_add' AND extra_data->>'status' = 'failed')
            GROUP BY user_id, event_name
        ),
        ai_power AS (
            SELECT COUNT(DISTINCT user_id) AS cnt
            FROM user_logs
            WHERE event_name = 'ai_chat'
              AND event_time >= ${start}::timestamptz
              AND event_time <  ${end}::timestamptz
        ),
        overall AS (
            SELECT
                COALESCE(SUM(cnt) FILTER (WHERE event_name = 'bookmark_add'), 0) AS new_bookmarks,
                COUNT(*)          FILTER (WHERE event_name = 'bookmark_add')    AS bookmark_users,
                COALESCE(SUM(cnt) FILTER (WHERE event_name = 'subscribe'), 0)    AS new_subscriptions,
                COUNT(*)          FILTER (WHERE event_name = 'archive')          AS archive_users,
                COUNT(*)          FILTER (WHERE event_name = 'ai_summary')          AS summary_users,
                COUNT(*)          FILTER (WHERE event_name = 'ai_overview')          AS overview_users
            FROM per_user_event
        ),
        first_registers AS (
            SELECT user_id, first_time AS reg_time
            FROM per_user_event WHERE event_name = 'register'
        ),
        activated AS (
            SELECT COUNT(*) AS cnt
            FROM first_registers fr
            WHERE EXISTS (
                SELECT 1 FROM user_logs b
                WHERE b.user_id    = fr.user_id
                  AND b.event_name = 'bookmark_add'
                  AND COALESCE(b.extra_data->>'status', 'success') <> 'failed'
                  AND b.event_time >= fr.reg_time
                  AND b.event_time <  fr.reg_time + INTERVAL '24 hours'
                  AND b.event_time >= ${start}::timestamptz
                  AND b.event_time <  ${end}::timestamptz + INTERVAL '24 hours'
            )
        )
        SELECT
            overall.*,
            activated.cnt AS activated_users,
            ai_power.cnt AS ai_power_users
        FROM overall
        CROSS JOIN activated
        CROSS JOIN ai_power`
    })
    const row = rows[0]
    return {
      new_bookmarks: Number(row.new_bookmarks),
      bookmark_users: Number(row.bookmark_users),
      new_subscriptions: Number(row.new_subscriptions),
      archive_users: Number(row.archive_users),
      activated_users: Number(row.activated_users),
      ai_power_users: Number(row.ai_power_users),
      summary_users: Number(row.summary_users),
      overview_users: Number(row.overview_users)
    }
  }

  async queryByPlatform(start: Date, end: Date): Promise<PlatformMetric[]> {
    const rows = await this.client().$transaction(async tx => {
      return tx.$queryRaw<PlatformMetric[]>`
        WITH register_by_platform AS (
            SELECT platform, COUNT(*) AS new_users
            FROM user_logs
            WHERE event_name = 'register'
              AND event_time >= ${start}::timestamptz
              AND event_time <  ${end}::timestamptz
            GROUP BY platform
        ),
        heartbeat_pairs AS (
            SELECT user_id, platform
            FROM user_logs
            WHERE event_name = 'heartbeat'
              AND event_time >= ${start}::timestamptz
              AND event_time <  ${end}::timestamptz
            GROUP BY user_id, platform
        ),
        heartbeat_by_platform AS (
            SELECT platform, COUNT(*) AS active_users
            FROM heartbeat_pairs GROUP BY platform
        )
        SELECT
            COALESCE(h.platform, r.platform) AS platform,
            COALESCE(r.new_users, 0)         AS new_users,
            COALESCE(h.active_users, 0)      AS active_users
        FROM heartbeat_by_platform h
        FULL OUTER JOIN register_by_platform r USING (platform)`
    })
    return rows.map(r => ({
      platform: r.platform,
      new_users: Number(r.new_users),
      active_users: Number(r.active_users)
    }))
  }

  async queryDaily(start: Date, end: Date): Promise<DailyMetrics[]> {
    const rows = await this.client().$queryRaw<Array<Record<string, unknown>>>`
    WITH days AS (
      SELECT generate_series(
        (${start}::timestamptz AT TIME ZONE 'Asia/Shanghai')::date,
        ((${end}::timestamptz - INTERVAL '1 microsecond') AT TIME ZONE 'Asia/Shanghai')::date,
        INTERVAL '1 day'
      )::date AS day
    ),
    event_base AS MATERIALIZED (
      SELECT
        (event_time AT TIME ZONE 'Asia/Shanghai')::date AS day,
        event_name,
        user_id,
        platform,
        event_time,
        extra_data
      FROM user_logs
      WHERE event_name IN ('register', 'subscribe', 'archive', 'ai_summary', 'ai_overview')
        AND event_time >= ${start}::timestamptz
        AND event_time <  ${end}::timestamptz
      UNION ALL
      SELECT
        (event_time AT TIME ZONE 'Asia/Shanghai')::date AS day,
        event_name,
        user_id,
        platform,
        event_time,
        extra_data
      FROM user_logs
      WHERE event_name = 'bookmark_add'
        AND event_time >= ${start}::timestamptz
        AND event_time <  ${end}::timestamptz + INTERVAL '24 hours'
    ),
    core_daily AS (
      SELECT
        day,
        COUNT(*) FILTER (WHERE event_name = 'register' AND platform = 'ios')::int     AS new_users_ios,
        COUNT(*) FILTER (WHERE event_name = 'register' AND platform = 'android')::int AS new_users_android,
        COUNT(*) FILTER (WHERE event_name = 'register' AND platform = 'web')::int     AS new_users_web,
        COUNT(*)                FILTER (WHERE event_name = 'bookmark_add'
                                          AND COALESCE(extra_data->>'status', 'success') <> 'failed')::int AS new_bookmarks,
        COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'bookmark_add'
                                          AND COALESCE(extra_data->>'status', 'success') <> 'failed')::int AS bookmark_users,
        COUNT(*)                FILTER (WHERE event_name = 'subscribe'
                                          AND COALESCE(extra_data->>'status', 'success') <> 'failed')::int AS new_subscriptions,
        COUNT(*)                FILTER (WHERE event_name = 'subscribe'
                                          AND extra_data->>'source' = 'stripe'
                                          AND COALESCE(extra_data->>'status', 'success') <> 'failed')::int AS new_subscriptions_stripe,
        COUNT(*)                FILTER (WHERE event_name = 'subscribe'
                                          AND extra_data->>'source' = 'apple_iap'
                                          AND COALESCE(extra_data->>'status', 'success') <> 'failed')::int AS new_subscriptions_apple_iap,
        COUNT(*)                FILTER (WHERE event_name = 'subscribe'
                                          AND extra_data->>'source' = 'trial'
                                          AND COALESCE(extra_data->>'status', 'success') <> 'failed')::int AS new_subscriptions_trial,
        COUNT(*)                FILTER (WHERE event_name = 'subscribe'
                                          AND extra_data->>'source' = 'blogger_trial'
                                          AND COALESCE(extra_data->>'status', 'success') <> 'failed')::int AS new_subscriptions_blogger_trial,
        COUNT(*)                FILTER (WHERE event_name = 'subscribe'
                                          AND extra_data->>'status' = 'failed')::int AS subscription_failed,
        COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'archive')::int      AS archive_users,
        COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'ai_summary')::int   AS summary_users,
        COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'ai_overview')::int  AS overview_users
      FROM event_base
      WHERE event_time < ${end}::timestamptz
      GROUP BY day
    ),
    first_register AS (
      SELECT
        user_id,
        MIN(event_time) AS reg_time,
        (MIN(event_time) AT TIME ZONE 'Asia/Shanghai')::date AS day
      FROM event_base
      WHERE event_name = 'register'
      GROUP BY user_id
    ),
    activated_daily AS (
      SELECT fr.day, COUNT(*)::int AS activated_users
      FROM first_register fr
      WHERE EXISTS (
        SELECT 1 FROM event_base b
        WHERE b.user_id    = fr.user_id
          AND b.event_name = 'bookmark_add'
          AND COALESCE(b.extra_data->>'status', 'success') <> 'failed'
          AND b.event_time >= fr.reg_time
          AND b.event_time <  fr.reg_time + INTERVAL '24 hours'
      )
      GROUP BY fr.day
    ),
    heartbeat_distinct AS (
      SELECT
        (event_time AT TIME ZONE 'Asia/Shanghai')::date AS day,
        platform,
        user_id
      FROM user_logs
      WHERE event_name = 'heartbeat'
        AND event_time >= ${start}::timestamptz
        AND event_time <  ${end}::timestamptz
      GROUP BY 1, 2, 3
    ),
    heartbeat_pivot AS (
      SELECT
        day,
        COUNT(*) FILTER (WHERE platform = 'ios')::int       AS active_users_ios,
        COUNT(*) FILTER (WHERE platform = 'android')::int   AS active_users_android,
        COUNT(*) FILTER (WHERE platform = 'web')::int       AS active_users_web,
        COUNT(*) FILTER (WHERE platform = 'extension')::int AS active_users_extension,
        COUNT(DISTINCT user_id)::int                        AS active_users_total
      FROM heartbeat_distinct
      GROUP BY day
    ),
    ai_power_daily AS (
      SELECT
        (event_time AT TIME ZONE 'Asia/Shanghai')::date AS day,
        COUNT(DISTINCT user_id)::int                    AS ai_power_users
      FROM user_logs
      WHERE event_name = 'ai_chat'
        AND event_time >= ${start}::timestamptz
        AND event_time <  ${end}::timestamptz
      GROUP BY 1
    )

    SELECT
      TO_CHAR(d.day, 'YYYY-MM-DD') AS day,

      COALESCE(c.new_users_ios, 0)::int           AS new_users_ios,
      COALESCE(c.new_users_android, 0)::int       AS new_users_android,
      COALESCE(c.new_users_web, 0)::int           AS new_users_web,

      COALESCE(hp.active_users_ios, 0)::int       AS active_users_ios,
      COALESCE(hp.active_users_android, 0)::int   AS active_users_android,
      COALESCE(hp.active_users_web, 0)::int       AS active_users_web,
      COALESCE(hp.active_users_extension, 0)::int AS active_users_extension,
      COALESCE(hp.active_users_total, 0)::int     AS active_users_total,

      COALESCE(c.new_bookmarks, 0)::int           AS new_bookmarks,
      COALESCE(c.bookmark_users, 0)::int          AS bookmark_users,
      COALESCE(c.new_subscriptions, 0)::int       AS new_subscriptions,
      COALESCE(c.new_subscriptions_stripe, 0)::int        AS new_subscriptions_stripe,
      COALESCE(c.new_subscriptions_apple_iap, 0)::int     AS new_subscriptions_apple_iap,
      COALESCE(c.new_subscriptions_trial, 0)::int         AS new_subscriptions_trial,
      COALESCE(c.new_subscriptions_blogger_trial, 0)::int AS new_subscriptions_blogger_trial,
      COALESCE(c.subscription_failed, 0)::int             AS subscription_failed,
      COALESCE(c.archive_users, 0)::int           AS archive_users,
      COALESCE(c.summary_users, 0)::int           AS summary_users,
      COALESCE(c.overview_users, 0)::int          AS overview_users,

      COALESCE(ac.activated_users, 0)::int        AS activated_users,
      COALESCE(ap.ai_power_users, 0)::int         AS ai_power_users
    FROM days d
    LEFT JOIN core_daily      c  ON c.day  = d.day
    LEFT JOIN heartbeat_pivot hp ON hp.day = d.day
    LEFT JOIN activated_daily ac ON ac.day = d.day
    LEFT JOIN ai_power_daily  ap ON ap.day = d.day
    ORDER BY d.day;`

    return rows.map(r => ({
      day: String(r.day),
      new_users: 0,
      new_users_ios: Number(r.new_users_ios),
      new_users_android: Number(r.new_users_android),
      new_users_web: Number(r.new_users_web),
      active_users: Number(r.active_users_total),
      active_users_ios: Number(r.active_users_ios),
      active_users_android: Number(r.active_users_android),
      active_users_extension: Number(r.active_users_extension),
      active_users_web: Number(r.active_users_web),
      new_bookmarks: Number(r.new_bookmarks),
      bookmark_users: Number(r.bookmark_users),
      new_subscriptions: Number(r.new_subscriptions),
      new_subscriptions_stripe: Number(r.new_subscriptions_stripe),
      new_subscriptions_apple_iap: Number(r.new_subscriptions_apple_iap),
      new_subscriptions_trial: Number(r.new_subscriptions_trial),
      new_subscriptions_blogger_trial: Number(r.new_subscriptions_blogger_trial),
      subscription_failed: Number(r.subscription_failed),
      archive_users: Number(r.archive_users),
      summary_users: Number(r.summary_users),
      overview_users: Number(r.overview_users),
      activated_users: Number(r.activated_users),
      ai_power_users: Number(r.ai_power_users)
    }))
  }

  // 访问总人数/人次(visit 事件)。游客(user_id=0)按 metadata.visitor_id 去重，登录用户按 user_id 去重
  async queryVisitOverview(start: Date, end: Date): Promise<VisitOverview> {
    const rows = await this.client().$queryRaw<VisitOverview[]>`
      SELECT
        COUNT(*)                                                              AS total_visits,
        COUNT(DISTINCT CASE WHEN user_id > 0 THEN 'u:' || user_id
                            ELSE 'g:' || (extra_data->>'visitor_id') END)     AS unique_visitors,
        COUNT(DISTINCT extra_data->>'visitor_id') FILTER (WHERE user_id = 0)  AS guest_visitors,
        COUNT(DISTINCT user_id)                   FILTER (WHERE user_id > 0)  AS member_visitors
      FROM user_logs
      WHERE event_name = 'visit'
        AND event_time >= ${start}::timestamptz
        AND event_time <  ${end}::timestamptz`
    const row = rows[0]
    return {
      total_visits: Number(row.total_visits),
      unique_visitors: Number(row.unique_visitors),
      guest_visitors: Number(row.guest_visitors),
      member_visitors: Number(row.member_visitors)
    }
  }

  // 访问最多的文章。只统计成功打开的 visit。游客(user_id=0)按 visitor_id 去重为"访客"，登录用户(user_id>0)按 user_id 去重为"用户"。标题在 service 层补
  async queryTopArticles(start: Date, end: Date, limit: number): Promise<TopArticleRow[]> {
    const rows = await this.client().$queryRaw<TopArticleRow[]>`
      SELECT
        extra_data->>'uuid'                                                   AS uuid,
        COUNT(DISTINCT extra_data->>'visitor_id') FILTER (WHERE user_id = 0)  AS guest_uv,
        COUNT(*)                                  FILTER (WHERE user_id = 0)  AS guest_visits,
        COUNT(DISTINCT user_id)                   FILTER (WHERE user_id > 0)  AS member_uv,
        COUNT(*)                                  FILTER (WHERE user_id > 0)  AS member_visits
      FROM user_logs
      WHERE event_name = 'visit'
        AND (extra_data->>'success')::boolean IS TRUE
        AND extra_data->>'uuid' IS NOT NULL
        AND event_time >= ${start}::timestamptz
        AND event_time <  ${end}::timestamptz
      GROUP BY 1
      ORDER BY (COUNT(DISTINCT extra_data->>'visitor_id') FILTER (WHERE user_id = 0)
                + COUNT(DISTINCT user_id) FILTER (WHERE user_id > 0)) DESC,
               COUNT(*) DESC
      LIMIT ${limit}`
    return rows.map(r => ({
      uuid: String(r.uuid),
      guest_uv: Number(r.guest_uv),
      guest_visits: Number(r.guest_visits),
      member_uv: Number(r.member_uv),
      member_visits: Number(r.member_visits)
    }))
  }

  // 新增书签里每个 step 的成功率(bookmark_add_step 事件)
  async queryBookmarkStepSuccess(start: Date, end: Date): Promise<BookmarkStepRow[]> {
    const rows = await this.client().$queryRaw<BookmarkStepRow[]>`
      SELECT
        extra_data->>'step_name'                                             AS step_name,
        COUNT(DISTINCT extra_data->>'bookmark_id')                           AS bookmarks,
        COUNT(*)                                                             AS attempts,
        COUNT(*) FILTER (WHERE extra_data->>'status' = 'success')            AS success,
        COUNT(*) FILTER (WHERE extra_data->>'status' = 'failed')             AS failed,
        ROUND(100.0 * COUNT(*) FILTER (WHERE extra_data->>'status' = 'success')
              / NULLIF(COUNT(*), 0), 2)::float8                              AS success_rate
      FROM user_logs
      WHERE event_name = 'bookmark_add_step'
        AND event_time >= ${start}::timestamptz
        AND event_time <  ${end}::timestamptz
      GROUP BY 1
      ORDER BY step_name`
    return rows.map(r => ({
      step_name: String(r.step_name),
      bookmarks: Number(r.bookmarks),
      attempts: Number(r.attempts),
      success: Number(r.success),
      failed: Number(r.failed),
      success_rate: Number(r.success_rate ?? 0)
    }))
  }

  // 漏斗入口层：bookmark_add 事件。attempts=发起次数，bookmarks=去重书签数（旧数据无 bookmark_id 则为 0），users=去重用户
  async queryBookmarkAddEntry(start: Date, end: Date): Promise<BookmarkAddEntryRow> {
    const rows = await this.client().$queryRaw<BookmarkAddEntryRow[]>`
      SELECT
        COUNT(*)                                                                       AS attempts,
        COUNT(DISTINCT extra_data->>'bookmark_id')                                     AS bookmarks,
        COUNT(DISTINCT user_id)                                                         AS users,
        COUNT(*) FILTER (WHERE COALESCE(extra_data->>'status', 'success') <> 'failed') AS success,
        COUNT(*) FILTER (WHERE extra_data->>'status' = 'failed')                       AS failed
      FROM user_logs
      WHERE event_name = 'bookmark_add'
        AND event_time >= ${start}::timestamptz
        AND event_time <  ${end}::timestamptz`
    const r = rows[0]
    return {
      attempts: Number(r?.attempts ?? 0),
      bookmarks: Number(r?.bookmarks ?? 0),
      users: Number(r?.users ?? 0),
      success: Number(r?.success ?? 0),
      failed: Number(r?.failed ?? 0)
    }
  }
}
