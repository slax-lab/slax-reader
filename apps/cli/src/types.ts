export type { ApiResponse } from '@slax-reader/contracts/http'
export type {
  AddUrlBookmarkRequest as AddUrlBookmarkReq,
  ArchiveBookmarkRequest as ArchiveBookmarkReq,
  StarBookmarkRequest as StarBookmarkReq,
  BookmarkIdRequest as TrashBookmarkReq,
} from '@slax-reader/contracts/bookmarks'

export interface UserInfo {
  id: number
  email: string
  username: string
  avatar: string
  [key: string]: unknown
}

export interface AddBookmarkReq {
  target_url: string
  target_title: string
  target_icon: string
  target_cover: string
  content: string
  description: string
  tag: string[]
}

export interface AddBookmarkResp {
  bmId: string
}

export interface BookmarkMetadata {
  bookmark_id?: number
  bookmark_user_uuid: string
  title: string
  alias_title: string
  host_url: string
  target_url: string
  content_word_count?: number
  description?: string
  byline?: string
  status: BookmarkParseStatus
  created_at?: string
  tags: BookmarkTag[]
}

export interface BookmarkListItem {
  id: number
  bookmark_user_uuid: string
  title: string
  alias_title: string
  host_url: string
  target_url: string
  content_icon: string
  content_cover: string
  content_word_count?: number
  description?: string
  byline?: string
  private_user?: number
  status: BookmarkParseStatus
  created_at?: string
  updated_at?: string
  published_at?: string
  site_name?: string
  archived: 'inbox' | 'archive' | 'later'
  starred: 'star' | 'unstar'
  trashed_at?: string | null
  type: 'shortcut' | 'article'
}

export interface BookmarkTag {
  name: string
  show_name: string
  id: number
  system: boolean
  display?: boolean
}

export enum BookmarkParseStatus {
  FAILED = 'failed',
  PENDING = 'pending',
  PENDING_IMPORT = 'pending_import',
  PENDING_RETRY = 'pending_retry',
  PARSEING = 'parseing',
  RETRYING = 'retrying',
  SUCCESS = 'success'
}