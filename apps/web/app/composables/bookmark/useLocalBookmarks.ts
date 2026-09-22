import { computed, type MaybeRef, toValue } from 'vue'

import { toUtcDate } from '@/utils/date'
import { sortBookmarkTags } from '@/utils/tags'

import type { BookmarkItem, BookmarkTag } from '@commons/frontend-types/models'
import { useQuery } from '@powersync/vue'
import type { PowerSyncDatabase } from '@powersync/web'

const WHERE_BY_TAB: Record<string, string> = {
  inbox: 'archive_status = 0 AND deleted_at IS NULL',
  archive: 'archive_status = 1 AND deleted_at IS NULL',
  starred: 'is_starred = 1 AND deleted_at IS NULL',
  trashed: 'deleted_at IS NOT NULL',
  // metadata.tags 缺失或为空数组
  untagged: "deleted_at IS NULL AND COALESCE(json_array_length(JSON_EXTRACT(metadata, '$.tags')), 0) = 0"
}

// 交集：每个选中的 tag uuid 都要出现在 metadata.tags 里
const tagIntersectionWhere = (n: number) =>
  Array.from({ length: n }, () => `EXISTS (SELECT 1 FROM json_each(JSON_EXTRACT(sr_user_bookmark.metadata, '$.tags')) WHERE value = ?)`).join(' AND ')

// inbox=created_at，star/arch 各 _at，回收站=deleted_at
const ORDER_BY_BY_TAB: Record<string, string> = {
  inbox: 'created_at DESC',
  archive: 'archived_at DESC',
  starred: 'starred_at DESC',
  trashed: 'deleted_at DESC',
  untagged: 'created_at DESC'
}
const orderByForTab = (tab: string) => ORDER_BY_BY_TAB[tab] ?? 'updated_at DESC'

interface LocalBookmarkRow {
  id: string
  archive_status: number
  is_starred: number
  created_at: string
  updated_at: string
  starred_at: string | null
  archived_at: string | null
  alias_title: string
  type: number
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
  m_tags: string | null
}

const SELECT_COLS = `
  id, archive_status, is_starred, created_at, updated_at, starred_at, archived_at, alias_title, type,
  JSON_EXTRACT(metadata, '$.bookmark.title')              AS m_title,
  JSON_EXTRACT(metadata, '$.bookmark.target_url')         AS m_target_url,
  JSON_EXTRACT(metadata, '$.bookmark.host_url')           AS m_host_url,
  JSON_EXTRACT(metadata, '$.bookmark.site_name')          AS m_site_name,
  JSON_EXTRACT(metadata, '$.bookmark.content_icon')       AS m_content_icon,
  JSON_EXTRACT(metadata, '$.bookmark.content_cover')      AS m_content_cover,
  JSON_EXTRACT(metadata, '$.bookmark.description')        AS m_description,
  JSON_EXTRACT(metadata, '$.bookmark.byline')             AS m_byline,
  JSON_EXTRACT(metadata, '$.bookmark.status')             AS m_status,
  JSON_EXTRACT(metadata, '$.bookmark.content_word_count') AS m_word_count,
  JSON_EXTRACT(metadata, '$.bookmark.published_at')       AS m_published_at,
  JSON_EXTRACT(metadata, '$.tags')                        AS m_tags
`

interface LocalUserTagRow {
  id: string
  tag_name: string | null
  display: unknown
  source?: string | null
  last_used_at?: string | null
}

const USER_TAG_COLS = 'id, tag_name, display, source, last_used_at'
// 最近用过的在前，没用过的在后（SQLite 没有 NULLS LAST）
const USER_TAG_ORDER = 'ORDER BY (last_used_at IS NULL), last_used_at DESC, created_at DESC'

const truthy = (v: unknown) => v === 1 || v === '1' || v === true || v === 'true'

function tagRowToBookmarkTag(r: LocalUserTagRow): BookmarkTag {
  return {
    id: r.id as unknown as number,
    id_kind: 'uuid',
    name: r.tag_name ?? '',
    show_name: r.tag_name ?? '',
    source: r.source === 'mine' ? 'mine' : 'auto',
    last_used_at: r.last_used_at ?? null,
    display: truthy(r.display)
  }
}

const parseTagIds = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return []
  }
}

// 按 id 去重，避免重复 key 崩溃
function dedupeTagsById(rows: LocalUserTagRow[]): BookmarkTag[] {
  const seen = new Set<string>()
  const out: BookmarkTag[] = []
  for (const r of rows) {
    const t = tagRowToBookmarkTag(r)
    const k = String(t.id)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

function rowToItem(r: LocalBookmarkRow): BookmarkItem {
  return {
    // local-first 主键是 uuid 字符串；BookmarkItem.id 历史是 number，做类型断言。
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
    archived_at: r.archived_at ? toUtcDate(r.archived_at).toISOString() : null,
    published_at: r.m_published_at ?? undefined,
    archived: r.archive_status === 1 ? 'archive' : 'inbox',
    starred: r.is_starred === 1 ? 'star' : 'unstar',
    trashed_at: null,
    type: r.type === 1 ? 'shortcut' : 'article',
    // 卡片上的标签由 useBookmarkData 用词表把 uuid 换成名字
    tag_ids: parseTagIds(r.m_tags)
  }
}

const listSql = (where: string, orderBy = 'updated_at DESC') => `SELECT ${SELECT_COLS} FROM sr_user_bookmark WHERE ${where} ORDER BY ${orderBy}`
const detailSql = (where: string) => `SELECT ${SELECT_COLS}, deleted_at, is_read, metadata FROM sr_user_bookmark WHERE ${where}`

export const useLocalBookmarks = () => {
  const { $powersync } = useNuxtApp()
  const db = $powersync as PowerSyncDatabase
  const nowIso = () => new Date().toISOString()

  // === 读（useQuery，响应式参数；必须在 setup 调用）===

  // 列表：tab → WHERE；topics 按选中的 tag uuid 交集过滤；非 local tab / topics 未选 tag → WHERE 0（0 行）
  const watchList = (tab: MaybeRef<string>, tagIds?: MaybeRef<string[] | undefined>) => {
    const ids = computed(() => (toValue(tab) === 'topics' ? (toValue(tagIds) ?? []) : []))
    const sql = computed(() => {
      const t = toValue(tab)
      const order = orderByForTab(t)
      if (t === 'topics') {
        return ids.value.length > 0 ? listSql(`deleted_at IS NULL AND ${tagIntersectionWhere(ids.value.length)}`, order) : listSql('0', order)
      }
      return WHERE_BY_TAB[t] ? listSql(WHERE_BY_TAB[t], order) : listSql('0', order)
    })
    const params = computed(() => [...ids.value])
    // isLoading：sync 流就绪 + 首批结果到达前为 true（见 @powersync/vue useQuery）。用于消除列表首次加载时的空状态闪烁。
    const { data, isLoading } = useQuery<LocalBookmarkRow>(sql, params)
    const items = computed(() => data.value.map(r => rowToItem(r as LocalBookmarkRow)))
    return { items, isLoading }
  }

  // 详情单条：enabled=false（owner 未判定）时 WHERE 0
  const watchDetail = (uuid: MaybeRef<string>, enabled: MaybeRef<boolean> = true) => {
    const on = computed(() => !!toValue(enabled) && !!toValue(uuid))
    const sql = computed(() => (on.value ? detailSql('id = ?') : detailSql('0')))
    const params = computed(() => (on.value ? [toValue(uuid)] : []))
    const { data } = useQuery<LocalBookmarkRow>(sql, params)
    const row = computed(() => (data.value[0] as LocalBookmarkRow) ?? null)
    return { row }
  }

  // 词表：只要 display 的，mine 优先、最近使用倒序（display 是同步来的 text，在 JS 里判）
  const watchUserTags = (enabled: MaybeRef<boolean> = true) => {
    const sql = computed(() => (toValue(enabled) ? `SELECT ${USER_TAG_COLS} FROM sr_user_tag ${USER_TAG_ORDER}` : `SELECT ${USER_TAG_COLS} FROM sr_user_tag WHERE 0`))
    const { data } = useQuery<LocalUserTagRow>(sql, [])
    // 按 id + source 集合记忆：不变返回同一引用，
    // 避免每个 PowerSync tick 重渲染。
    let prevKey = ''
    let prevTags: BookmarkTag[] = []
    const tags = computed(() => {
      const next = sortBookmarkTags(dedupeTagsById(data.value as LocalUserTagRow[]).filter(t => !!t.display))
      const key = next.map(t => `${t.id}:${t.source}`).join('|')
      if (key === prevKey) return prevTags
      prevKey = key
      prevTags = next
      return next
    })
    return { tags }
  }

  // 筛选页 “+” 的候选词：交集里还出现的标签，带剩余篇数，不含已选
  const watchCandidateTags = (tagIds: MaybeRef<string[]>) => {
    const ids = computed(() => toValue(tagIds) ?? [])
    const sql = computed(() =>
      ids.value.length > 0
        ? `SELECT je.value AS id, COUNT(*) AS count FROM sr_user_bookmark b, json_each(JSON_EXTRACT(b.metadata, '$.tags')) je
           WHERE b.deleted_at IS NULL AND ${tagIntersectionWhere(ids.value.length).replaceAll('sr_user_bookmark.metadata', 'b.metadata')}
           AND je.value NOT IN (${ids.value.map(() => '?').join(', ')}) GROUP BY je.value`
        : `SELECT id, 0 AS count FROM sr_user_tag WHERE 0`
    )
    const params = computed(() => [...ids.value, ...ids.value])
    const { data } = useQuery<{ id: string; count: number }>(sql, params)
    const { tags: vocabulary } = watchUserTags()
    const candidates = computed<BookmarkTag[]>(() => {
      const counts = new Map(data.value.map(r => [String(r.id), Number(r.count)]))
      return vocabulary.value
        .filter(t => counts.has(String(t.id)))
        .map(t => ({ ...t, count: counts.get(String(t.id)) || 0 }))
        .sort((a, b) => (b.count || 0) - (a.count || 0))
    })
    return { candidates }
  }

  // 某书签当前标签（metadata.tags uuid 数组 JOIN sr_user_tag）
  const watchBookmarkTags = (uuid: MaybeRef<string>, enabled: MaybeRef<boolean> = true) => {
    const on = computed(() => !!toValue(enabled) && !!toValue(uuid))
    const sql = computed(() =>
      on.value
        ? `SELECT t.id AS id, t.tag_name AS tag_name, t.display AS display, t.source AS source, t.last_used_at AS last_used_at FROM sr_user_bookmark b, json_each(JSON_EXTRACT(b.metadata, '$.tags')) je JOIN sr_user_tag t ON t.id = je.value WHERE b.id = ?`
        : `SELECT ${USER_TAG_COLS} FROM sr_user_tag WHERE 0`
    )
    const params = computed(() => (on.value ? [toValue(uuid)] : []))
    const { data, isLoading } = useQuery<LocalUserTagRow>(sql, params)
    // 同上：按 id 集合记忆，避免无谓重渲染。
    let prevKey = ''
    let prevTags: BookmarkTag[] = []
    const tags = computed(() => {
      const next = sortBookmarkTags(dedupeTagsById(data.value as LocalUserTagRow[]))
      const key = next.map(t => String(t.id)).join('|')
      if (key === prevKey) return prevTags
      prevKey = key
      prevTags = next
      return next
    })
    return { tags, isLoading }
  }

  // 该 uuid 是否在本地库（= owner，决定 /b 是否接管 local-first）
  const exists = async (uuid: string): Promise<boolean> => {
    const r = await db.getOptional<{ id: string }>('SELECT id FROM sr_user_bookmark WHERE id = ?', [uuid])
    return !!r
  }

  // === 写（db.execute，移植 client 写 SQL）===
  const setArchive = (uuid: string, archive: boolean) =>
    db.execute('UPDATE sr_user_bookmark SET archive_status = ?, archived_at = ?, updated_at = ? WHERE id = ?', [archive ? 1 : 0, archive ? nowIso() : null, nowIso(), uuid])

  const setStar = (uuid: string, star: boolean) =>
    db.execute('UPDATE sr_user_bookmark SET is_starred = ?, starred_at = ?, updated_at = ? WHERE id = ?', [star ? 1 : 0, star ? nowIso() : null, nowIso(), uuid])

  const setTrashed = (uuid: string, trashed: boolean) =>
    db.execute('UPDATE sr_user_bookmark SET deleted_at = ?, updated_at = ? WHERE id = ?', [trashed ? nowIso() : null, nowIso(), uuid])

  const setAliasTitle = (uuid: string, title: string) => db.execute('UPDATE sr_user_bookmark SET alias_title = ?, updated_at = ? WHERE id = ?', [title, nowIso(), uuid])

  const setTags = (uuid: string, tagIds: string[]) =>
    // 去重写入，自愈历史重复
    db.execute(`UPDATE sr_user_bookmark SET metadata = JSON_SET(COALESCE(metadata, '{}'), '$.tags', JSON(?)), updated_at = ? WHERE id = ?`, [
      JSON.stringify([...new Set(tagIds)]),
      nowIso(),
      uuid
    ])

  const getBookmarkTagIds = async (uuid: string): Promise<string[]> => {
    const r = await db.getOptional<{ tags: string | null }>(`SELECT JSON_EXTRACT(metadata, '$.tags') AS tags FROM sr_user_bookmark WHERE id = ?`, [uuid])
    if (!r?.tags) return []
    try {
      const arr = JSON.parse(r.tags)
      return Array.isArray(arr) ? (arr as string[]) : []
    } catch {
      return []
    }
  }

  const addBookmarkTag = async (bookmarkUuid: string, tagUuid: string) => {
    const ids = await getBookmarkTagIds(bookmarkUuid)
    if (ids.includes(tagUuid)) return
    await setTags(bookmarkUuid, [...ids, tagUuid])
  }
  const removeBookmarkTag = async (bookmarkUuid: string, tagUuid: string) => {
    const ids = await getBookmarkTagIds(bookmarkUuid)
    await setTags(
      bookmarkUuid,
      ids.filter(id => id !== tagUuid)
    )
  }

  // add-url：本地插入 pending 行
  // 不写 deleted_at，避免后端判为删除
  const createBookmark = async (url: string): Promise<string> => {
    const id = crypto.randomUUID()
    const now = nowIso()
    const metadata = JSON.stringify({
      tags: [],
      share: null,
      bookmark: {
        uuid: id,
        title: url, // 占位，解析后覆盖
        byline: '',
        status: 'pending', // 已添加未解析
        host_url: url,
        site_name: '',
        target_url: url,
        description: '',
        content_icon: '',
        published_at: now,
        content_cover: '',
        content_word_count: 0
      }
    })
    await db.execute(
      `INSERT INTO sr_user_bookmark (id, is_read, archive_status, is_starred, created_at, updated_at, alias_title, type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, 0, 0, 0, now, now, '', 0, metadata]
    )
    return id
  }

  // 用户打的词是我的标签；服务端 executeCreateTag 也按 mine 写，这里先写好不等回流
  const createUserTag = async (tagName: string): Promise<BookmarkTag> => {
    const id = crypto.randomUUID()
    await db.execute(`INSERT INTO sr_user_tag (id, user_id, tag_name, display, source, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [id, '', tagName, '1', 'mine', nowIso()])
    return { id: id as unknown as number, id_kind: 'uuid', name: tagName, show_name: tagName, source: 'mine', last_used_at: null, display: true }
  }

  const getReadingPosition = (uuid: string) =>
    db.getOptional<{ anchor_index: number; anchor_ratio: number; percent: number }>('SELECT anchor_index, anchor_ratio, percent FROM local_reading_state WHERE id = ?', [uuid])

  const setReadingPosition = (uuid: string, pos: { index: number; ratio: number; percent: number }) =>
    db.execute(
      `INSERT INTO ps_data_local__local_reading_state (id, data)
       VALUES (?, json_object('anchor_index', ?, 'anchor_ratio', ?, 'percent', ?, 'updated_at', ?))
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [uuid, pos.index, pos.ratio, pos.percent, nowIso()]
    )

  const clearReadingPosition = (uuid: string) => db.execute('DELETE FROM local_reading_state WHERE id = ?', [uuid])

  return {
    watchList,
    watchDetail,
    exists,
    setArchive,
    setStar,
    setTrashed,
    setAliasTitle,
    setTags,
    watchUserTags,
    watchCandidateTags,
    watchBookmarkTags,
    getBookmarkTagIds,
    addBookmarkTag,
    removeBookmarkTag,
    createBookmark,
    createUserTag,
    getReadingPosition,
    setReadingPosition,
    clearReadingPosition
  }
}
