import { computed, type MaybeRef, toValue } from 'vue'

import { toUtcDate } from '@/utils/date'

import type { BookmarkItem } from '@slax-reader/contracts/interface'
import { useQuery } from '@powersync/vue'
import type { PowerSyncDatabase } from '@powersync/web'

// 订阅的专栏（列表项）
export interface LocalCollectionItem {
  id: string // sr_user_collection.id（本地文本主键）
  code: string
  name: string
  avatar: string
  description: string
  owner_id: string
  type: number // 1=free 2=paid
  status: number // 1=open 0=closed
  subscription_end_time: string
  subscribed_at: string
  is_cancelled: boolean
  last_read_at: string
  has_new: boolean // 有比 last_read_at 更新的文章
  updated_at: string
}

// 专栏文章（含划线/评论汇总）。两个字段来自 sr_user_bookmark_stats，彼此独立：
// - mark_count（= comment_count）：作者划线 + 访客留言的总数
// - first_mark（= first_comment）：仅作者的首条评论(type 2/5)，可能为空（例如只有划线没评论）
// 故 UI 需分别判空，不能用 count > 0 推断 first_mark 存在，反之亦然。
export interface CollectionBookmarkItem extends BookmarkItem {
  mark_count: number
  first_mark: { content: string; comment: string; source: string } | null
  // 入栏时间：用 starred_at
  starred_at: string | null
}

interface LocalCollectionRow {
  id: string
  code: string | null
  name: string | null
  avatar: string | null
  description: string | null
  owner_id: string | null
  type: number | null
  status: number | null
  subscription_end_time: string | null
  subscribed_at: string | null
  is_cancelled: number | null
  last_read_at: string | null
  latest_article_at: string | null
  updated_at: string | null
}

interface LocalCollectionBookmarkRow {
  id: string
  owner_id: string
  alias_title: string
  created_at: string
  updated_at: string
  starred_at: string | null
  m_title: string | null
  m_target_url: string | null
  m_host_url: string | null
  m_site_name: string | null
  m_content_icon: string | null
  m_content_cover: string | null
  m_description: string | null
  m_byline: string | null
  m_status: string | null
  m_word_count: number | null
  m_published_at: string | null
  mark_count: number | null
  mp_content: string | null
  mp_comment: string | null
  mp_source: string | null
}

const BOOKMARK_COLS = `
  cb.id, cb.owner_id, cb.alias_title, cb.created_at, cb.updated_at, cb.starred_at,
  JSON_EXTRACT(cb.metadata, '$.bookmark.title')              AS m_title,
  JSON_EXTRACT(cb.metadata, '$.bookmark.target_url')         AS m_target_url,
  JSON_EXTRACT(cb.metadata, '$.bookmark.host_url')           AS m_host_url,
  JSON_EXTRACT(cb.metadata, '$.bookmark.site_name')          AS m_site_name,
  JSON_EXTRACT(cb.metadata, '$.bookmark.content_icon')       AS m_content_icon,
  JSON_EXTRACT(cb.metadata, '$.bookmark.content_cover')      AS m_content_cover,
  JSON_EXTRACT(cb.metadata, '$.bookmark.description')        AS m_description,
  JSON_EXTRACT(cb.metadata, '$.bookmark.byline')             AS m_byline,
  JSON_EXTRACT(cb.metadata, '$.bookmark.status')             AS m_status,
  JSON_EXTRACT(cb.metadata, '$.bookmark.content_word_count') AS m_word_count,
  JSON_EXTRACT(cb.metadata, '$.bookmark.published_at')       AS m_published_at,
  COALESCE(stats.comment_count, 0)                            AS mark_count,
  JSON_EXTRACT(stats.first_comment, '$.content')              AS mp_content,
  JSON_EXTRACT(stats.first_comment, '$.comment')              AS mp_comment,
  JSON_EXTRACT(stats.first_comment, '$.source')               AS mp_source
`

// 我订阅（未删除）的专栏，JOIN 专栏信息 + 该专栏最新入栏时间（算未读）。关闭的专栏也保留（status 交给 UI）
// 入栏时间取 starred_at
const SUBSCRIBED_SQL = `
  SELECT
    c.id                       AS id,
    c.collection_code          AS code,
    c.display_name             AS name,
    c.avatar                   AS avatar,
    c.description              AS description,
    c.owner_id                 AS owner_id,
    c.type                     AS type,
    c.status                   AS status,
    s.subscription_end_time    AS subscription_end_time,
    s.created_at               AS subscribed_at,
    s.is_cancelled             AS is_cancelled,
    s.last_read_at             AS last_read_at,
    (SELECT MAX(cb.starred_at) FROM sr_collection_bookmark cb WHERE cb.owner_id = c.owner_id) AS latest_article_at,
    c.updated_at               AS updated_at
  FROM sr_user_collection_subscriber s
  JOIN sr_user_collection c ON c.id = s.collection_id
  ORDER BY s.updated_at DESC
`

// 同一份未读语义的单专栏版本，供 setLastRead 写前判断
const SUBSCRIBER_READ_STATE_SQL = `
  SELECT
    s.id          AS id,
    s.last_read_at AS last_read_at,
    (SELECT MAX(cb.starred_at) FROM sr_collection_bookmark cb WHERE cb.owner_id = c.owner_id) AS latest_article_at
  FROM sr_user_collection_subscriber s
  JOIN sr_user_collection c ON c.id = s.collection_id
  WHERE c.collection_code = ?
`

// 未读 = 有文章的入栏时间晚于 last_read_at（从未读过则只要有文章就算未读）
// 时间串格式混杂（同步下来是 'YYYY-MM-DD HH:MM:SS'，本地写入是 ISO），统一过 toUtcDate 比较，避免字符串比较错判
const hasUnread = (lastReadAt: string | null, latestArticleAt: string | null): boolean => {
  if (!latestArticleAt) return false
  const latest = toUtcDate(latestArticleAt).getTime()
  if (Number.isNaN(latest)) return false
  if (!lastReadAt) return true
  const lastRead = toUtcDate(lastReadAt).getTime()
  return Number.isNaN(lastRead) || latest > lastRead
}

function rowToCollection(r: LocalCollectionRow): LocalCollectionItem {
  return {
    id: r.id,
    code: r.code ?? '',
    name: r.name ?? '',
    avatar: r.avatar ?? '',
    description: r.description ?? '',
    owner_id: r.owner_id ?? '',
    type: r.type ?? 1,
    status: r.status ?? 0,
    subscription_end_time: r.subscription_end_time ? toUtcDate(r.subscription_end_time).toISOString() : '',
    subscribed_at: r.subscribed_at ? toUtcDate(r.subscribed_at).toISOString() : '',
    is_cancelled: r.is_cancelled === 1,
    last_read_at: r.last_read_at ? toUtcDate(r.last_read_at).toISOString() : '',
    has_new: hasUnread(r.last_read_at, r.latest_article_at),
    updated_at: r.updated_at ? toUtcDate(r.updated_at).toISOString() : ''
  }
}

function rowToItem(r: LocalCollectionBookmarkRow): CollectionBookmarkItem {
  const hasFirst = !!(r.mp_content || r.mp_comment)
  return {
    id: r.id as unknown as number,
    title: r.m_title ?? '',
    alias_title: r.alias_title ?? '',
    host_url: r.m_host_url ?? '',
    target_url: r.m_target_url ?? '',
    content_icon: r.m_content_icon ?? '',
    content_cover: r.m_content_cover ?? '',
    content_word_count: r.m_word_count ?? 0,
    description: r.m_description ?? '',
    byline: r.m_byline ?? '',
    site_name: r.m_site_name ?? '',
    status: (r.m_status ?? 'success') as BookmarkItem['status'],
    created_at: toUtcDate(r.created_at).toISOString(),
    updated_at: toUtcDate(r.updated_at).toISOString(),
    starred_at: r.starred_at ? toUtcDate(r.starred_at).toISOString() : null,
    published_at: r.m_published_at ?? undefined,
    archived: 'inbox',
    starred: r.starred_at ? 'star' : 'unstar',
    trashed_at: null,
    type: 'article',
    mark_count: Number(r.mark_count ?? 0),
    first_mark: hasFirst ? { content: r.mp_content ?? '', comment: r.mp_comment ?? '', source: r.mp_source ?? '' } : null
  }
}

export const useLocalCollections = () => {
  const { $powersync } = useNuxtApp()
  const db = $powersync as PowerSyncDatabase
  const nowIso = () => new Date().toISOString()

  const watchSubscribedCollections = (enabled: MaybeRef<boolean> = true) => {
    const sql = computed(() => (toValue(enabled) ? SUBSCRIBED_SQL : `SELECT * FROM sr_user_collection WHERE 0`))
    const { data, isLoading } = useQuery<LocalCollectionRow>(sql, [])
    const items = computed(() => data.value.map(r => rowToCollection(r as LocalCollectionRow)))
    return { items, isLoading }
  }

  const watchCollectionBookmarks = (collectionCode: MaybeRef<string | undefined>) => {
    const on = computed(() => !!toValue(collectionCode))
    const sql = computed(() =>
      on.value
        ? `SELECT ${BOOKMARK_COLS}
           FROM sr_collection_bookmark cb
           LEFT JOIN sr_user_bookmark_stats stats ON stats.bookmark_uuid = cb.id
           WHERE cb.owner_id IN (SELECT owner_id FROM sr_user_collection WHERE collection_code = ?)
           ORDER BY cb.starred_at DESC`
        : `SELECT ${BOOKMARK_COLS}
           FROM sr_collection_bookmark cb
           LEFT JOIN sr_user_bookmark_stats stats ON stats.bookmark_uuid = cb.id
           WHERE 0`
    )
    const params = computed(() => (on.value ? [toValue(collectionCode)] : []))
    const { data, isLoading } = useQuery<LocalCollectionBookmarkRow>(sql, params)
    const items = computed(() => data.value.map(r => rowToItem(r as LocalCollectionBookmarkRow)))
    return { items, isLoading }
  }

  const setLastRead = async (collectionCode: string): Promise<boolean> => {
    const state = await db.getOptional<{ id: string; last_read_at: string | null; latest_article_at: string | null }>(SUBSCRIBER_READ_STATE_SQL, [collectionCode])
    if (!state || !hasUnread(state.last_read_at, state.latest_article_at)) return false

    await db.execute('UPDATE sr_user_collection_subscriber SET last_read_at = ? WHERE id = ?', [nowIso(), state.id])
    return true
  }

  return {
    watchSubscribedCollections,
    watchCollectionBookmarks,
    setLastRead
  }
}
