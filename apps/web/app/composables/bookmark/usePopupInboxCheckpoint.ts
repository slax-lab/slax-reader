import { readPopupInboxCheckpoint } from '@/composables/bookmark/localPopupNotifications'
import { POPUP_INBOX_CHECKPOINT, POPUP_INBOX_RELAY_READY, POPUP_INBOX_RELAY_REQUEST, type PopupBookmarkCheckpoint } from '@commons/frontend-types/frontend'
import { useDocumentVisibility } from '@vueuse/core'

export function usePopupInboxCheckpoint(isInbox: () => boolean, isReady: () => boolean) {
  const db = useNuxtApp().$powersync
  if (!import.meta.client || !db) return
  const owner = useState<string | null>('powersync-owner', () => null)
  const visibility = useDocumentVisibility()
  const relayReady = ref(false)
  const requestRelay = () => window.postMessage({ type: POPUP_INBOX_RELAY_REQUEST }, location.origin)
  let generation = 0
  let capturing = false
  let checkpoint: PopupBookmarkCheckpoint | undefined

  const publish = () => {
    if (checkpoint && checkpoint.userKey === owner.value && isInbox() && visibility.value === 'visible') {
      window.postMessage({ type: POPUP_INBOX_CHECKPOINT, checkpoint }, location.origin)
    }
  }
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== POPUP_INBOX_RELAY_READY) return
    relayReady.value = true
    publish()
  }

  const reset = () => {
    generation++
    checkpoint = undefined
    capturing = false
  }
  watch([isInbox, owner], reset, { flush: 'sync' })
  watch(visibility, state => { if (state === 'hidden') reset() }, { flush: 'sync' })

  watch(isInbox, inside => { if (inside && !relayReady.value) requestRelay() })
  watch([isInbox, isReady, owner, visibility, relayReady], async ([inside, ready, userKey, visible, connected]) => {
    if (!inside || !ready || visible !== 'visible' || !userKey || !connected || capturing) return
    if (checkpoint) {
      publish()
      return
    }
    const visit = generation
    capturing = true
    try {
      const snapshot = await readPopupInboxCheckpoint(db, userKey)
      if (generation !== visit) return
      checkpoint = snapshot
      publish()
    } catch (error) {
      console.warn('[popup] Inbox checkpoint unavailable', error)
    } finally {
      if (generation === visit) capturing = false
    }
  }, { immediate: true, flush: 'post' })

  onMounted(() => {
    window.addEventListener('message', onMessage)
    if (isInbox()) requestRelay()
  })
  onUnmounted(() => {
    generation++
    window.removeEventListener('message', onMessage)
  })
}
