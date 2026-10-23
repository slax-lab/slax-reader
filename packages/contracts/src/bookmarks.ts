import type { CursorPage } from './http.js'

export interface BookmarkExportItem {
  url: string
  title: string
  tags: { name: string; source: string }[]
  saved_at: string
  is_read: boolean
  is_archived: boolean
  is_starred: boolean
  type: 'article' | 'shortcut' | 'pdf'
}

export type BookmarkExportResponse = CursorPage<BookmarkExportItem>

export interface AddBookmarkRequest {
  target_url: string
  target_title: string
  target_icon: string
  taget_cover: string
  content: string
  description: string
  tag: string[]
}

export interface AddUrlBookmarkRequest {
  saved_at?: string
  is_starred?: boolean
  import_only?: boolean
  target_url: string
  target_title?: string
  thumbnail?: string
  description?: string
  tags: string[]
  is_archive?: boolean
}

export interface BookmarkExistsResponse {
  exists: boolean
  parse_type: number
  bookmark_id?: number
  bookmark_uid?: string
}

export interface BookmarkRef {
  bookmark_id?: number
  bookmark_uid?: string
}
export interface BookmarkIdRequest {
  bookmark_id: number
}
export interface ArchiveBookmarkRequest extends BookmarkRef {
  status: 'inbox' | 'archive' | 'later'
}
export interface StarBookmarkRequest extends BookmarkRef {
  status: 'star' | 'unstar'
}
export interface RenameBookmarkRequest extends BookmarkRef {
  alias_title: string
}
export interface AddBookmarkTagRequest extends BookmarkRef {
  tag_name?: string
  tag_id?: number
}
export interface SetBookmarkTagsRequest extends BookmarkRef {
  tags: { name: string; id?: number }[]
}
export interface RemoveBookmarkTagRequest extends BookmarkRef {
  tag_id: number
}
/** Existing create responses return an empty string when no bookmark was created. */
export interface AddBookmarkResponse {
  bmId: number | ''
}

export interface ForkBookmarkRequest {
  source_user_bookmark_uuid: string
}

export interface ForkBookmarkResponse {
  bookmark_uid: string
  disposition: 'created' | 'already_saved' | 'updated'
}

export type BookmarkForkAttribution =
  | {
      status: 'available'
      source_bookmark_uid: string
      display_name: string | null
    }
  | { status: 'unavailable' }

export interface BookmarkForkMetadata {
  /** Viewer-only availability: active/failed same-resource saves; success requires exact Fork provenance. */
  viewer_fork_status?: 'pending' | 'success' | 'failed' | null
  has_fork: boolean
  can_fork: boolean
  fork: BookmarkForkAttribution | null
}

/** Accept only snapshot paths at explicitly configured Reader origins. */
// WHATWG URL is available in every supported runtime. Keep its type local so
// contracts do not add browser or Node globals to their consumers.
declare const URL: new (value: string) => {
  protocol: string
  username: string
  password: string
  origin: string
  pathname: string
  search: string
  hash: string
  href: string
}

export function readerBookmarkUuid(target: string, readerOrigins: readonly string[]): string | null {
  try {
    const url = new URL(target)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    const trusted = readerOrigins.some(value => {
      try {
        const configured = new URL(value)
        return !configured.username && !configured.password && !configured.search && !configured.hash && configured.origin === url.origin
      } catch {
        return false
      }
    })
    if (!trusted) return null
    return /^\/b\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(url.pathname)?.[1]?.toLowerCase() ?? null
  } catch {
    return null
  }
}

/** Keep old queued failures addressable by each device's local UUID. */
export function failedReaderSaveUrl(target: string, clientUuid: string): string {
  const url = new URL(target)
  url.hash = `slax-failed-save=${encodeURIComponent(clientUuid)}`
  return url.href
}
