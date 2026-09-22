// Local-first 划线/评论数据层
// 读用 useQuery，写用 db.execute
import { computed, type MaybeRef, ref, toValue, watchEffect } from 'vue'

import { toUtcDate } from '@/utils/date'

import type { HighlightItem, MarkDetail, MarkInfo, MarkPathApprox, MarkPathItem, MarkSelectContent, MarkUserInfo } from '@slax-reader/contracts/interface'
import { useQuery } from '@powersync/vue'
import type { PowerSyncDatabase } from '@powersync/web'
import { useUserStore } from '~/stores/user'

const HIGHLIGHT_TYPE: Record<number, HighlightItem['type']> = { 1: 'mark', 2: 'comment', 3: 'reply', 4: 'mark', 5: 'comment' }

interface LocalCommentRow {
  id: string
  type: number
  source: string | null
  comment: string | null
  approx_source: string | null
  content: string | null
  is_deleted: number
  created_at: string
  m_user_id: string | null
  m_root_id: string | null
  m_parent_id: string | null
  u_name: string | null
  u_picture: string | null
}

interface LocalHighlightRow {
  id: string
  type: number
  comment: string | null
  content: string | null
  approx_source: string | null
  created_at: string
  source_id: string | null
  title: string | null
  parent_comment: string | null
  parent_deleted: number | null
}

// uuid/数字串 → 稳定数字 id
function toStableId(s: string | null | undefined): number {
  if (!s) return 0
  if (/^\d+$/.test(s)) return Number(s)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

function decodeOr<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// 行 → MarkDetail
// 本人用真实 userId，否则删除失配
function buildMarkDetail(rows: LocalCommentRow[], currentUser?: { uuid: string; userId: number } | null): MarkDetail {
  const resolveUserId = (uuid: string | null | undefined): number => (currentUser && uuid && uuid === currentUser.uuid ? currentUser.userId : toStableId(uuid))

  const markList: MarkInfo[] = rows.map(r => ({
    id: toStableId(r.id),
    uuid: r.id,
    user_id: resolveUserId(r.m_user_id),
    type: r.type,
    source: decodeOr<MarkPathItem[]>(r.source, []),
    approx_source: decodeOr<MarkPathApprox | undefined>(r.approx_source, undefined),
    parent_id: toStableId(r.m_parent_id),
    parent_uid: r.m_parent_id ?? '',
    root_id: toStableId(r.m_root_id),
    root_uid: r.m_root_id ?? '',
    comment: r.comment ?? '',
    created_at: toUtcDate(r.created_at),
    is_deleted: r.is_deleted !== 0,
    children: []
  }))

  const userList: Record<string, MarkUserInfo> = {}
  for (const r of rows) {
    if (!r.m_user_id) continue
    const numId = resolveUserId(r.m_user_id)
    const key = String(numId)
    if (userList[key]) continue
    userList[key] = { id: numId, username: r.u_name ?? '', avatar: r.u_picture ?? '' }
  }

  return { mark_list: markList, user_list: userList }
}

// ADD_MARK 请求的 body
export interface AddMarkBody {
  bm_id?: number | string
  comment?: string
  type: number
  source?: MarkPathItem[]
  parent_uid?: string
  select_content?: unknown[]
  approx_source?: MarkPathApprox
  [k: string]: unknown
}

const MARK_DETAIL_COLS = `
  c.id AS id, c.type AS type, c.source AS source, c.comment AS comment,
  c.approx_source AS approx_source, c.content AS content, c.is_deleted AS is_deleted, c.created_at AS created_at,
  JSON_EXTRACT(c.metadata, '$.user_id')   AS m_user_id,
  JSON_EXTRACT(c.metadata, '$.root_id')   AS m_root_id,
  JSON_EXTRACT(c.metadata, '$.parent_id') AS m_parent_id,
  u.name AS u_name, u.picture AS u_picture`
const markDetailSql = (where: string) => `SELECT ${MARK_DETAIL_COLS} FROM sr_bookmark_comment c LEFT JOIN sr_user u ON u.id = JSON_EXTRACT(c.metadata, '$.user_id') WHERE ${where}`

const HIGHLIGHTS_SQL = `
  SELECT c.id AS id, c.type AS type, c.comment AS comment, c.content AS content,
         c.approx_source AS approx_source, c.created_at AS created_at,
         c.user_bookmark_uuid AS source_id,
         JSON_EXTRACT(b.metadata, '$.bookmark.title') AS title,
         p.comment AS parent_comment, p.is_deleted AS parent_deleted
  FROM sr_bookmark_comment c
  LEFT JOIN sr_user_bookmark b ON b.id = c.user_bookmark_uuid
  LEFT JOIN sr_bookmark_comment p ON p.id = JSON_EXTRACT(c.metadata, '$.parent_id')
  WHERE c.is_deleted = 0
  ORDER BY c.created_at DESC`

export const useLocalMarks = () => {
  const { $powersync } = useNuxtApp()
  const db = $powersync as PowerSyncDatabase
  const userStore = useUserStore()
  const nowIso = () => new Date().toISOString()

  // === 读 ===

  // 详情页全部划线/评论；未就绪时 WHERE 0
  const watchMarkDetail = (bookmarkUuid: MaybeRef<string>, enabled: MaybeRef<boolean> = true) => {
    const on = computed(() => !!toValue(enabled) && !!toValue(bookmarkUuid))
    const sql = computed(() => (on.value ? markDetailSql('c.user_bookmark_uuid = ?') : markDetailSql('0')))
    const params = computed(() => (on.value ? [toValue(bookmarkUuid)] : []))
    // 须显式订阅 comment 流
    // 否则本地写入被对账抹掉
    const options = computed(() => ({
      streams: on.value ? [{ name: 'bookmark_comment', parameters: { bookmark_uuid: toValue(bookmarkUuid) }, waitForStream: true }] : []
    }))
    const { data, isLoading } = useQuery<LocalCommentRow>(sql, params, options)

    // 本人 uuid↔userId 映射，异步
    const currentUser = ref<{ uuid: string; userId: number } | null>(null)
    watchEffect(() => {
      if (!on.value || currentUser.value) return
      const userId = userStore.userInfo?.userId
      if (userId == null) return
      db.getOptional<{ id: string }>('SELECT id FROM sr_user LIMIT 1').then(r => {
        if (r?.id) currentUser.value = { uuid: r.id, userId }
      })
    })

    // 按内容签名记忆：PowerSync 每次 emission 都给新数组引用，
    // 若每次都重建 MarkDetail，会让上层 watch(marks) 误判变化 → 每个评论同步 tick 全量重绘整篇高亮。
    // 仅当渲染相关字段真正变化时才产出新对象，否则返回同一引用让 computed 短路。
    let cachedSig = ''
    let cachedMarks: MarkDetail = { mark_list: [], user_list: {} }
    const marks = computed<MarkDetail>(() => {
      const rows = data.value as LocalCommentRow[]
      const sig =
        JSON.stringify(
          rows.map(r => [r.id, r.type, r.is_deleted, r.comment, r.source, r.approx_source, r.m_user_id, r.m_parent_id, r.m_root_id, r.created_at, r.u_name, r.u_picture])
        ) + `#${currentUser.value?.uuid ?? ''}:${currentUser.value?.userId ?? ''}`
      if (sig === cachedSig) return cachedMarks
      cachedSig = sig
      cachedMarks = buildMarkDetail(rows, currentUser.value)
      return cachedMarks
    })
    return { marks, isLoading }
  }

  // highlights tab：跨书签聚合
  const watchHighlights = (enabled: MaybeRef<boolean> = true) => {
    const sql = computed(() => (toValue(enabled) ? HIGHLIGHTS_SQL : `SELECT * FROM sr_bookmark_comment WHERE 0`))
    // isLoading：消除首次加载空态闪烁
    const { data, isLoading } = useQuery<LocalHighlightRow>(sql, [])
    const highlights = computed<HighlightItem[]>(() =>
      data.value.map(row => {
        const r = row as LocalHighlightRow
        const type = HIGHLIGHT_TYPE[r.type] ?? 'mark'
        return {
          id: r.id as unknown as number,
          type,
          content: decodeOr<MarkSelectContent[]>(r.content, []),
          created_at: toUtcDate(r.created_at).toISOString(),
          title: r.title ?? '',
          color: '',
          parent_comment: type === 'reply' ? (r.parent_comment ?? 'Deleted') : '',
          parent_comment_deleted: r.parent_deleted === 1,
          comment: r.comment ?? '',
          source_type: 'bookmark',
          source_id: r.source_id ?? '',
          approx_source: decodeOr<MarkPathApprox | undefined>(r.approx_source, undefined)
        } as HighlightItem
      })
    )
    return { highlights, isLoading }
  }

  // === 写 ===
  const getCurrentUserId = async (): Promise<string> => {
    const r = await db.getOptional<{ id: string }>('SELECT id FROM sr_user LIMIT 1')
    return r?.id ?? ''
  }

  const addMark = async (bookmarkUuid: string, body: AddMarkBody): Promise<{ mark_uid: string; root_uid: string }> => {
    const id = crypto.randomUUID()
    const userId = await getCurrentUserId()

    const parentUuid = body.parent_uid || ''
    let rootUuid: string
    let metaRootId: string | null
    let metaParentId: string | null
    if (parentUuid) {
      const parent = await db.getOptional<{ root_id: string | null }>(`SELECT JSON_EXTRACT(metadata, '$.root_id') AS root_id FROM sr_bookmark_comment WHERE id = ?`, [parentUuid])
      rootUuid = parent?.root_id || parentUuid
      metaRootId = rootUuid
      metaParentId = parentUuid
    } else {
      rootUuid = id
      metaRootId = null
      metaParentId = null
    }

    const source = Array.isArray(body.source) && body.source.length ? JSON.stringify(body.source) : ''
    const approx = body.approx_source ? JSON.stringify(body.approx_source) : ''
    const content = JSON.stringify(body.select_content ?? [])
    const metadata = JSON.stringify({ root_id: metaRootId, user_id: userId, parent_id: metaParentId, source_id: null, bookmark_id: null })

    await db.execute(
      `INSERT INTO sr_bookmark_comment (id, type, source, user_bookmark_uuid, comment, approx_source, content, is_deleted, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, body.type, source, bookmarkUuid, body.comment ?? '', approx, content, 0, nowIso(), metadata]
    )

    return { mark_uid: id, root_uid: rootUuid }
  }

  const deleteMark = (markUid: string) => db.execute('UPDATE sr_bookmark_comment SET is_deleted = 1 WHERE id = ?', [markUid])

  return { watchMarkDetail, watchHighlights, addMark, deleteMark }
}
