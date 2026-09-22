import type { CursorPage } from './http.js'

export interface BookmarkExportItem {
  url: string
  title: string
  tags: { name: string; source: string }[]
  saved_at: string
  is_read: boolean
  is_archived: boolean
  is_starred: boolean
  type: 'article' | 'shortcut'
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
