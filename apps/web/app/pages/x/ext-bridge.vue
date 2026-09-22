<template>
  <div></div>
</template>

<script lang="ts" setup>

import { isAllowedExtensionOrigin, parseExtensionBridgeIds } from '~/utils/extensionBridge'

import type { UserInfo } from '@slax-reader/contracts/interface'
import type { PowerSyncDatabase } from '@powersync/web'
import { useUserStore } from '~/stores/user'

definePageMeta({ layout: false })
useHead({ meta: [{ name: 'robots', content: 'noindex,nofollow' }] })

type Req = { id: number; method: string; params?: Record<string, unknown> }

type SyncStatusSnapshot = {
  connected: boolean
  connecting: boolean
  downloading: boolean
  uploading: boolean
  hasSynced: boolean
  lastSyncedAt: string | null
  downloadError: string | null
  uploadError: string | null
}

const { $powersync } = useNuxtApp()
const db = $powersync as PowerSyncDatabase | null
const userStore = useUserStore()

const runtimeConfig = useRuntimeConfig().public
let bridgeClientId = ''
try {
  bridgeClientId = window.sessionStorage.getItem('slax:ext-bridge-client-id')?.toLowerCase() || ''
} catch {}
const configuredExtensionIds = parseExtensionBridgeIds(runtimeConfig.EXTENSION_BRIDGE_IDS)
const isExtensionOrigin = (origin: string) =>
  isAllowedExtensionOrigin({ origin, clientId: bridgeClientId, configuredIds: configuredExtensionIds, environment: runtimeConfig.slaxEnv })

type JsonRecord = Record<string, unknown>

type BookmarkRow = {
  id: string
  archive_status: number | null
  is_starred: number | null
  created_at: string | null
  updated_at: string | null
  alias_title: string | null
  type: number | null
  metadata: string | null
}

type LocalBookmarkInfoRow = {
  overview: string | null
  key_takeaways: string | null
}

type CommentRow = {
  id: string
  type: number
  source: string | null
  approx_source: string | null
  comment: string | null
  is_deleted: number | null
  created_at: string | null
  user_uuid: string | null
  root_uuid: string | null
  parent_uuid: string | null
}

type UserRow = { id: string; name: string | null; picture: string | null }
type TagRow = { id: string; tag_name: string | null; display: string | number | null }

type AddMarkBody = {
  bookmark_uid?: string
  comment?: string
  type?: number
  source?: unknown[]
  parent_uid?: string
  select_content?: unknown[]
  approx_source?: Record<string, unknown>
}

const BOOKMARK_URL_SQL = `
  SELECT id, archive_status, is_starred, created_at, updated_at, alias_title, type, metadata
  FROM sr_user_bookmark
  WHERE deleted_at IS NULL
    AND JSON_EXTRACT(metadata, '$.bookmark.target_url') = ?
  ORDER BY created_at DESC
  LIMIT 1
`

const asRecord = (value: unknown): JsonRecord => (value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {})

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return (value as T) ?? fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const scalar = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const parsed = parseJson<unknown>(value, value)
  return parsed
}

const text = (value: unknown, fallback = '') => {
  const normalized = scalar(value)
  return typeof normalized === 'string' ? normalized : normalized == null ? fallback : String(normalized)
}

const integer = (value: unknown, fallback = 0) => {
  const normalized = Number(scalar(value))
  return Number.isFinite(normalized) ? normalized : fallback
}

const truthy = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true'

const getSyncStatus = (): SyncStatusSnapshot => {
  const status = db?.currentStatus
  return {
    connected: status?.connected === true,
    connecting: status?.connecting === true,
    downloading: status?.downloading === true,
    uploading: status?.uploading === true,
    hasSynced: status?.hasSynced === true,
    lastSyncedAt: status?.lastSyncedAt?.toISOString() ?? null,
    downloadError: status?.downloadError ? String(status.downloadError) : null,
    uploadError: status?.uploadError ? String(status.uploadError) : null
  }
}

const toMarkDetail = async (bookmarkUuid: string) => {
  const rows = await db!.getAll<CommentRow>(
    `
      SELECT c.id, c.type, c.source, c.approx_source, c.comment, c.is_deleted, c.created_at,
        JSON_EXTRACT(c.metadata, '$.user_id') AS user_uuid,
        JSON_EXTRACT(c.metadata, '$.root_id') AS root_uuid,
        JSON_EXTRACT(c.metadata, '$.parent_id') AS parent_uuid
      FROM sr_bookmark_comment c
      WHERE c.user_bookmark_uuid = ?
      ORDER BY c.created_at ASC
    `,
    [bookmarkUuid]
  )

  let currentUser: UserRow | undefined
  try {
    currentUser = (await db!.getAll<UserRow>('SELECT id, name, picture FROM sr_user LIMIT 1'))[0]
  } catch {}

  const configuredUserId = integer(localStorage.getItem('slax:powersync:lastUser'), 0)
  const userIds = new Map<string, number>()
  const userList: Record<string, { id: number; username: string; avatar: string }> = {}
  let nextUserId = 1
  const resolveUserId = (userUuid: string | null) => {
    if (!userUuid) return 0
    if (currentUser?.id === userUuid && configuredUserId > 0) return configuredUserId
    const existing = userIds.get(userUuid)
    if (existing) return existing
    const id = nextUserId++
    userIds.set(userUuid, id)
    const isCurrent = currentUser?.id === userUuid
    userList[String(id)] = {
      id,
      username: isCurrent ? currentUser?.name || '' : '',
      avatar: isCurrent ? currentUser?.picture || '' : ''
    }
    return id
  }

  const markIds = new Map(rows.map((row, index) => [row.id, index + 1]))
  const markList = rows.map((row, index) => {
    const rootUid = text(row.root_uuid)
    const parentUid = text(row.parent_uuid)
    const userId = resolveUserId(text(row.user_uuid) || null)
    return {
      id: index + 1,
      uuid: row.id,
      user_id: userId,
      type: row.type,
      source: parseJson<unknown[]>(row.source, []),
      approx_source: parseJson<Record<string, unknown> | undefined>(row.approx_source, undefined),
      parent_id: markIds.get(parentUid) ?? 0,
      parent_uid: parentUid,
      root_id: markIds.get(rootUid) ?? index + 1,
      root_uid: rootUid,
      comment: row.comment ?? '',
      created_at: row.created_at ?? new Date(0).toISOString(),
      is_deleted: row.is_deleted !== 0,
      children: []
    }
  })

  return { mark_list: markList, user_list: userList }
}

const getLocalBookmarkInfo = async (bookmarkUuid: string): Promise<LocalBookmarkInfoRow | undefined> => {
  try {
    return (await db!.getAll<LocalBookmarkInfoRow>('SELECT overview, key_takeaways FROM local_bookmark_info WHERE id = ?', [bookmarkUuid]))[0]
  } catch {
    return undefined
  }
}

const getLocalTags = async (tagIds: string[]) => {
  if (!tagIds.length) return []
  let rows: TagRow[] = []
  try {
    rows = await db!.getAll<TagRow>('SELECT id, tag_name, display FROM sr_user_tag')
  } catch {}
  const byId = new Map(rows.map(row => [String(row.id), row]))
  return tagIds.map(id => {
    const row = byId.get(id)
    return {
      id,
      name: row?.tag_name ?? id,
      show_name: row?.tag_name ?? id,
      system: false,
      display: row ? truthy(row.display) : true
    }
  })
}

const toBookmarkPayload = async (row: BookmarkRow) => {
  const metadata = asRecord(parseJson<unknown>(row.metadata, {}))
  const bookmark = asRecord(metadata.bookmark)
  const tagIds = Array.isArray(metadata.tags) ? metadata.tags.map(tag => text(tag)).filter(Boolean) : []
  const localInfo = await getLocalBookmarkInfo(row.id)
  const keyTakeaways = parseJson<unknown[]>(localInfo?.key_takeaways, [])

  return {
    uuid: row.id,
    url: text(bookmark.target_url),
    title: text(bookmark.title),
    alias_title: row.alias_title ?? '',
    host_url: text(bookmark.host_url),
    site_name: text(bookmark.site_name),
    content_icon: text(bookmark.content_icon),
    content_cover: text(bookmark.content_cover),
    content: text(bookmark.content),
    content_word_count: integer(bookmark.content_word_count),
    description: text(bookmark.description),
    byline: text(bookmark.byline),
    status: text(bookmark.status, 'success'),
    published_at: text(bookmark.published_at) || null,
    created_at: row.created_at ?? new Date(0).toISOString(),
    updated_at: row.updated_at ?? row.created_at ?? new Date(0).toISOString(),
    archived: row.archive_status === 1 ? ('archive' as const) : ('inbox' as const),
    starred: row.is_starred === 1 ? ('star' as const) : ('unstar' as const),
    tags: await getLocalTags(tagIds),
    overview: text(localInfo?.overview),
    key_takeaways: keyTakeaways.filter((item): item is string => typeof item === 'string'),
    marks: await toMarkDetail(row.id)
  }
}

const currentUserUuid = async () => {
  const user = (await db!.getAll<UserRow>('SELECT id, name, picture FROM sr_user LIMIT 1'))[0]
  if (!user?.id) throw new Error('local-first user is not ready')
  return user.id
}

const createLocalMark = async (body: AddMarkBody) => {
  if (!body.bookmark_uid || typeof body.type !== 'number') throw new Error('bridge mark requires bookmark_uid and type')
  const id = crypto.randomUUID()
  const parentUuid = body.parent_uid || ''
  let rootUuid: string = id
  let rootId: string | null = null
  let parentId: string | null = null

  if (parentUuid) {
    const parent = await db!.getAll<{ root_id: string | null }>(
      `SELECT JSON_EXTRACT(metadata, '$.root_id') AS root_id FROM sr_bookmark_comment WHERE id = ?`,
      [parentUuid]
    )
    rootUuid = parent[0]?.root_id || parentUuid
    rootId = rootUuid
    parentId = parentUuid
  }

  const userId = await currentUserUuid()
  const source = Array.isArray(body.source) && body.source.length ? JSON.stringify(body.source) : ''
  const approx = body.approx_source ? JSON.stringify(body.approx_source) : ''
  const content = JSON.stringify(body.select_content ?? [])
  const metadata = JSON.stringify({ root_id: rootId, user_id: userId, parent_id: parentId, source_id: null, bookmark_id: null })
  await db!.execute(
    `INSERT INTO sr_bookmark_comment (id, type, source, user_bookmark_uuid, comment, approx_source, content, is_deleted, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, body.type, source, body.bookmark_uid, body.comment ?? '', approx, content, 0, new Date().toISOString(), metadata]
  )
  return { mark_uid: id, root_uid: rootUuid }
}

const deleteLocalMark = async (markUid: unknown) => {
  if (typeof markUid !== 'string' || !markUid) throw new Error('bridge delete mark requires mark_uid')
  await db!.execute('UPDATE sr_bookmark_comment SET is_deleted = 1 WHERE id = ?', [markUid])
  return { ok: true as const }
}

const getBridgeState = async () => {
  await db!.waitForReady()
  const sync = getSyncStatus()
  const count = await db!.getAll<{ total: number }>(`SELECT COUNT(*) AS total FROM sr_user_bookmark WHERE deleted_at IS NULL`)
  const hasLocalData = Number(count[0]?.total ?? 0) > 0
  return {
    state: sync.hasSynced ? ('synced' as const) : hasLocalData ? ('local' as const) : ('not-ready' as const),
    userKey: localStorage.getItem('slax:powersync:lastUser'),
    hasSynced: sync.hasSynced,
    hasLocalData,
    sync
  }
}

const handlers: Record<string, (params?: Record<string, unknown>) => Promise<unknown>> = {
  // 健康检查
  async status() {
    const state = await getBridgeState()
    const tables = await db!.getAll<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name='ps_data__sr_user_bookmark'`)
    return { ...state, ok: true, hasBookmarkTable: tables.length > 0 }
  },

  async userInfo() {
    userStore.$hydrate()
    return JSON.parse(JSON.stringify(userStore.userInfo)) as UserInfo | null
  },

  async lookup(params) {
    const targetUrl = params?.url
    if (typeof targetUrl !== 'string') throw new Error('lookup requires a URL')
    const parsed = new URL(targetUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('lookup only accepts HTTP(S) URLs')

    const state = await getBridgeState()
    const rows = await db!.getAll<BookmarkRow>(BOOKMARK_URL_SQL, [targetUrl])
    const row = rows[0]
    const bookmark = row?.id ? await toBookmarkPayload(row) : null
    return {
      ...state,
      bookmark: bookmark?.url ? bookmark : null
    }
  },

  async createMark(params) {
    return createLocalMark((params?.body || {}) as AddMarkBody)
  },

  async deleteMark(params) {
    return deleteLocalMark(params?.markUid)
  }
}

let cleanup: (() => void) | null = null
let stopSyncStatusWatch: (() => void) | null = null

onMounted(() => {
  if (!bridgeClientId) {
    if (window.parent !== window) window.parent.postMessage({ type: 'slax-bridge-error', error: 'missing bridge client id' }, '*')
    return
  }

  const onMessage = async (e: MessageEvent) => {
    if (!isExtensionOrigin(e.origin)) return
    if (e.source !== window.parent) return
    const req = e.data as Req | null
    if (!req || typeof req.id !== 'number' || typeof req.method !== 'string') return

    const reply = (payload: Record<string, unknown>) => window.parent?.postMessage({ id: req.id, ...payload }, e.origin)

    if (!db && req.method !== 'userInfo') {
      reply({ error: 'powersync unavailable in bridge' })
      return
    }

    const handler = handlers[req.method]
    if (!handler) {
      reply({ error: `unknown method: ${req.method}` })
      return
    }

    try {
      reply({ result: await handler(req.params) })
    } catch (err) {
      reply({ error: String(err) })
    }
  }

  window.addEventListener('message', onMessage)
  cleanup = () => window.removeEventListener('message', onMessage)

  if (db) {
    void db
      .waitForReady()
      .then(async () => {
        let lastPublishedSyncStatus = ''
        const publishSyncStatus = (status: SyncStatusSnapshot) => {
          const serialized = JSON.stringify(status)
          if (serialized === lastPublishedSyncStatus) return
          lastPublishedSyncStatus = serialized
          window.parent?.postMessage({ type: 'slax-bridge-sync-status', status }, '*')
        }
        stopSyncStatusWatch = db.registerListener({
          statusChanged: status => {
            publishSyncStatus({
              connected: status.connected,
              connecting: status.connecting,
              downloading: status.downloading,
              uploading: status.uploading,
              hasSynced: status.hasSynced === true,
              lastSyncedAt: status.lastSyncedAt?.toISOString() ?? null,
              downloadError: status.downloadError ? String(status.downloadError) : null,
              uploadError: status.uploadError ? String(status.uploadError) : null
            })
          }
        })
        publishSyncStatus(getSyncStatus())
        window.parent?.postMessage({ type: 'slax-bridge-ready' }, '*')
      })
      .catch(error => {
        window.parent?.postMessage({ type: 'slax-bridge-error', error: String(error) }, '*')
      })
  } else {
    window.parent?.postMessage({ type: 'slax-bridge-error', error: 'powersync unavailable in bridge' }, '*')
  }
})

onUnmounted(() => {
  cleanup?.()
  stopSyncStatusWatch?.()
  stopSyncStatusWatch = null
})
</script>
