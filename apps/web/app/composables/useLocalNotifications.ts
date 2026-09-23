// Local-first 通知数据访问层（dweb app 层）。读用 @powersync/vue 的 useQuery（响应式），写用 db.execute。
// 替代原 SW WebSocket 未读提醒 + REST 通知列表/标记已读。仅客户端、PowerSync 可用时使用（见 isLocalFirstEnabled）。
import { computed, type MaybeRef,toValue } from 'vue'

import { useQuery } from '@powersync/vue'
import type { PowerSyncDatabase } from '@powersync/web'

export interface LocalNotificationItem {
  id: string // local 主键 = 通知 uuid
  uuid: string
  is_read: boolean
  title: string
  content: string
  quote_content: string
  bookmark_title: string
  username: string
  source: 'share' | 'collection'
  type: 'comment' | 'reply' | 'collection_subscriber' | 'collection_update' | 'collection_price_change'
  created_at: string
  icon: string
  object_data: {
    comment_id?: number
    comment_uuid?: string
    share_code?: string
    collection_code?: string
    collection_name?: string
    bookmark_id?: number
    cb_id?: number
  }
}

interface LocalNotificationRow {
  id: string
  type: string
  source: string
  title: string
  body: string
  details: string | null
  is_read: number
  created_at: string
  last_read_at: string | null
}

// 最近 3 个月窗口在客户端过滤：PowerSync sync rules 是确定性的，不支持 NOW()/INTERVAL/范围参数，
// 服务端按 3 个月过滤会让整个 user_data_v1 bucket 编译失败（连带书签/标签等全部停同步）。
// 故服务端同步全量通知，客户端按 cutoff(ISO 字符串比较) 过滤展示。
const threeMonthsAgoIso = (): string => {
  const d = new Date()
  d.setMonth(d.getMonth() - 3)
  return d.toISOString()
}

// last_read_at（用户级"全部已读"时间戳）作为子查询列带出，复刻服务端未读语义
const LIST_SQL = `
  SELECT id, type, source, title, body, details, is_read, created_at,
    (SELECT last_read_at FROM sr_user LIMIT 1) AS last_read_at
  FROM sr_user_notification
  WHERE created_at >= ?
  ORDER BY created_at DESC
  LIMIT ?
`

// 未读：3 个月内 且 is_read = 0 且 (last_read_at 为空 或 created_at > last_read_at)
const UNREAD_COUNT_SQL = `
  SELECT COUNT(*) AS cnt FROM sr_user_notification
  WHERE created_at >= ?
    AND is_read = 0
    AND (
      (SELECT last_read_at FROM sr_user LIMIT 1) IS NULL
      OR created_at > (SELECT last_read_at FROM sr_user LIMIT 1)
    )
`

function rowToItem(r: LocalNotificationRow): LocalNotificationItem {
  let d: Record<string, unknown> = {}
  try {
    d = r.details ? (JSON.parse(r.details) as Record<string, unknown>) : {}
  } catch {
    d = {}
  }

  // 有效已读：本条 is_read，或 created_at 早于"全部已读"时间戳
  const effectiveRead = r.is_read === 1 || (!!r.last_read_at && r.created_at <= r.last_read_at)

  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' && v ? Number(v) : undefined)
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

  return {
    id: r.id,
    uuid: r.id,
    is_read: effectiveRead,
    title: r.title ?? '',
    content: r.body ?? '',
    quote_content: str(d.quote_content) ?? '',
    bookmark_title: str(d.bookmark_title) ?? '',
    username: str(d.username) ?? '',
    source: (r.source as LocalNotificationItem['source']) ?? 'share',
    type: (r.type as LocalNotificationItem['type']) ?? 'comment',
    created_at: r.created_at,
    icon: str(d.avatar) ?? '',
    object_data: {
      comment_id: num(d.comment_id),
      comment_uuid: str(d.comment_uuid),
      share_code: str(d.share_code),
      collection_code: str(d.collection_code),
      collection_name: str(d.collection_name),
      bookmark_id: num(d.bookmark_id),
      cb_id: num(d.cb_id)
    }
  }
}

export const useLocalNotifications = () => {
  const { $powersync } = useNuxtApp()
  const db = $powersync as PowerSyncDatabase
  const nowIso = () => new Date().toISOString()

  // === 读（useQuery，响应式；必须在 setup 调用）===

  const cutoff = threeMonthsAgoIso()

  const watchUnreadCount = () => {
    const { data } = useQuery<{ cnt: number }>(UNREAD_COUNT_SQL, [cutoff])
    const unreadCount = computed(() => data.value[0]?.cnt ?? 0)
    return { unreadCount }
  }

  const watchList = (limit: MaybeRef<number> = 50) => {
    const params = computed(() => [cutoff, toValue(limit)])
    const { data } = useQuery<LocalNotificationRow>(LIST_SQL, params)
    const items = computed(() => data.value.map(r => rowToItem(r as LocalNotificationRow)))
    return { items }
  }

  // === 写（db.execute → PowerSync 上传 → 后端写回 sr_user_notification.is_read）===

  const markRead = (uuid: string) => db.execute('UPDATE sr_user_notification SET is_read = 1 WHERE id = ? AND is_read = 0', [uuid])

  // 全部已读：把当前未读行逐条置 1（各自写回同步，无需依赖 sr_user.last_read_at 写回）
  const markAllRead = () => db.execute('UPDATE sr_user_notification SET is_read = 1 WHERE is_read = 0')

  return {
    watchUnreadCount,
    watchList,
    markRead,
    markAllRead,
    nowIso
  }
}
