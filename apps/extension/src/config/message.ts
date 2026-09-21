import type { MetricActionType } from '@commons/types-pro'

export interface BridgeBookmarkTag {
  id: string
  name: string
  show_name: string
  system: boolean
  display: boolean
}

export interface BridgeMarkInfo {
  id: number
  uuid: string
  user_id: number
  type: number
  source: unknown[]
  approx_source?: Record<string, unknown>
  parent_id: number
  parent_uid: string
  root_id: number
  root_uid: string
  comment: string
  created_at: string
  is_deleted: boolean
  children: BridgeMarkInfo[]
}

export interface BridgeMarkDetail {
  mark_list: BridgeMarkInfo[]
  user_list: Record<string, { id: number; username: string; avatar: string }>
}

/** 序列化后的网页 PowerSync 书签行；扩展不在自己的 origin 持久化它。 */
export interface BridgeBookmarkPayload {
  uuid: string
  url: string
  title: string
  alias_title: string
  host_url: string
  site_name: string
  content_icon: string
  content_cover: string
  content?: string
  content_word_count: number
  description: string
  byline: string
  status: string
  published_at: string | null
  created_at: string
  updated_at: string
  archived: 'inbox' | 'archive' | 'later'
  starred: 'star' | 'unstar'
  tags: BridgeBookmarkTag[]
  overview: string
  key_takeaways: string[]
  marks: BridgeMarkDetail
}

export interface BookmarkLookupResult {
  bookmarkUid: string | null
  bridgeReady: boolean
  bookmark: BridgeBookmarkPayload | null
}

export enum MessageTypeAction {
  QueryHTMLContent = 'query-html-content',
  OpenWelcome = 'open-welcome-tab',
  ShowCollectPopup = 'show-collect-popup',
  HideCollectPopup = 'hide-collect-popup',
  QueryBookmarkChange = 'query-bookmark-change',
  CheckLogined = 'check-logined',
  QueryUserInfo = 'query-user-info',
  ContentScriptReady = 'content-script-ready',
  PageUrlUpdate = 'page-url-update',
  BookmarkStatusRefresh = 'bookmark-status-refresh',
  RecordBookmark = 'record-bookmark',
  TrackDashboardMetric = 'track-dashboard-metric',
  // pinnedStatus.ts / browserService.ts 等文件依赖这两个值，字符串值不可随意改动
  QueryPinnedStatus = 'query-pinned-status',
  PinnedStatusUpdate = 'pinned-status-update'
}

// Upstream Collect.vue uses this only to describe the UI action. The fork
// background handles RecordBookmark by refreshing the UUID bridge state.
export enum BookmarkActionType {
  ADD = 0,
  DELETE = 1
}

export type MessageType =
  | {
      action:
        | MessageTypeAction.QueryHTMLContent
        | MessageTypeAction.ShowCollectPopup
        | MessageTypeAction.HideCollectPopup
        | MessageTypeAction.OpenWelcome
        | MessageTypeAction.CheckLogined
        | MessageTypeAction.QueryUserInfo
        | MessageTypeAction.QueryPinnedStatus
        | MessageTypeAction.ContentScriptReady
    }
  | {
      action: MessageTypeAction.PinnedStatusUpdate
      isOnToolbar: boolean
    }
  | {
      action: MessageTypeAction.BookmarkStatusRefresh
      bookmarkUid?: string
    }
  | {
      action: MessageTypeAction.TrackDashboardMetric
      actionType?: MetricActionType
    }
  | {
      action: MessageTypeAction.QueryBookmarkChange
      url: string
    }
  | {
      action: MessageTypeAction.PageUrlUpdate
      url: string
    }
  | {
      action: MessageTypeAction.RecordBookmark
      url: string
      actionType: number
      bookmarkId?: number
    }
