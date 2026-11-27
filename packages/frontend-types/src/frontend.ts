/** Browser-extension panel position persisted in local storage. */
export interface PanelPosition {
  left?: string
  top?: string
  width?: string
  height?: string
}

/** Browser-extension-only local configuration. */
export interface LocalConfig {
  webPanelPosition?: PanelPosition
  autoToggle?: boolean
  sidebarWidthSync?: boolean
}

export interface PopupSaveState {
  inboxSeenAt: number
  pendingAtInboxIds: string[]
  dismissedIds: string[]
}

export interface PopupBookmarkCheckpoint {
  userKey: string
  seenAt: number
  ready: { id: string; createdAt: number }[]
  pendingIds: string[]
}

export interface PopupSaveNotification {
  kind: 'save'
  id: string
  title: string
}

export interface PopupSubscriptionNotification {
  kind: 'subscription'
  id: string
  title: string
  throughAt: string
}

export type PopupNotification = PopupSaveNotification | PopupSubscriptionNotification

export type PopupNotificationResult =
  | { state: 'ready'; items: PopupNotification[] }
  | { state: 'loading' | 'signed-out' | 'unavailable' }

export const POPUP_INBOX_CHECKPOINT = 'slax-reader:popup-inbox-checkpoint'
export const POPUP_INBOX_RELAY_READY = 'slax-reader:popup-inbox-relay-ready'
export const POPUP_INBOX_RELAY_REQUEST = 'slax-reader:popup-inbox-relay-request'

export const isPopupInboxPath = (path: string) => path === '/' || path === '/bookmarks' || path === '/bookmarks/'
