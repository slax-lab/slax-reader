import { isPopupInboxPath, POPUP_INBOX_CHECKPOINT, POPUP_INBOX_RELAY_READY, POPUP_INBOX_RELAY_REQUEST, type PopupBookmarkCheckpoint } from '@commons/frontend-types/frontend'

function isCheckpoint(value: unknown): value is PopupBookmarkCheckpoint {
  const checkpoint = value as PopupBookmarkCheckpoint | null
  return !!checkpoint && typeof checkpoint.userKey === 'string' && Number.isFinite(checkpoint.seenAt)
    && Array.isArray(checkpoint.ready) && checkpoint.ready.every(row => row && typeof row.id === 'string' && Number.isFinite(row.createdAt))
    && Array.isArray(checkpoint.pendingIds) && checkpoint.pendingIds.every(id => typeof id === 'string')
}

export function startPopupInboxRelay(): () => void {
  const base = process.env.PUBLIC_BASE_URL
  if (!base || window !== window.top || location.origin !== new URL(base).origin) return () => {}
  const ready = () => window.postMessage({ type: POPUP_INBOX_RELAY_READY }, location.origin)
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin || !isPopupInboxPath(location.pathname)) return
    if (event.data?.type === POPUP_INBOX_RELAY_REQUEST) ready()
    if (event.data?.type !== POPUP_INBOX_CHECKPOINT || !isCheckpoint(event.data.checkpoint)) return
    void browser.runtime.sendMessage({ target: 'slax-background', method: 'popup-inbox-checkpoint', checkpoint: event.data.checkpoint }).catch(() => undefined)
  }
  window.addEventListener('message', onMessage)
  if (isPopupInboxPath(location.pathname)) ready()
  return () => window.removeEventListener('message', onMessage)
}
