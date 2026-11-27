import type { BridgeService } from './bridgeService'
import { getSessionAccountKey, getTokenIdentityKeys, type SessionService } from './sessionService'
import type { PopupBookmarkCheckpoint, PopupNotification, PopupNotificationResult, PopupSaveNotification, PopupSaveState, PopupSubscriptionNotification } from '@commons/frontend-types/frontend'

export function clearPopupInbox(state: PopupSaveState | undefined, checkpoint: PopupBookmarkCheckpoint): PopupSaveState {
  if (state && checkpoint.seenAt <= state.inboxSeenAt) return state

  const dismissed = new Set(state?.dismissedIds)
  if (state) {
    const pending = new Set(state.pendingAtInboxIds)
    for (const row of checkpoint.ready) {
      if (row.createdAt > state.inboxSeenAt || pending.has(row.id)) dismissed.add(row.id)
    }
  }
  return {
    inboxSeenAt: checkpoint.seenAt,
    pendingAtInboxIds: checkpoint.pendingIds.filter(id => !dismissed.has(id)),
    dismissedIds: [...dismissed]
  }
}

export function dismissPopupSave(state: PopupSaveState, id: string): PopupSaveState {
  return {
    ...state,
    pendingAtInboxIds: state.pendingAtInboxIds.filter(pendingId => pendingId !== id),
    dismissedIds: [...new Set([...state.dismissedIds, id])]
  }
}

export function selectPopupNotifications(subscriptions: PopupSubscriptionNotification[], saves: PopupSaveNotification[]): PopupNotification[] {
  if (subscriptions.length && saves.length) return [subscriptions[0], saves[0]]
  return (subscriptions.length ? subscriptions : saves).slice(0, 2)
}

const TOOLBAR_WATCH_ID = 'toolbar-notifications'
type PopupAccount = { userKey: string; storageKey: string }
type PopupListener = (result: PopupNotificationResult, account: PopupAccount | null) => void

export class PopupNotifications {
  private writes: Promise<unknown> = Promise.resolve()
  private listeners = new Set<PopupListener>()
  private readonly startedAt = Date.now()
  private watching = false
  private checking = false
  private dirty = false
  private generation = 0

  constructor(
    private session: Pick<SessionService, 'hasSession' | 'getToken'>,
    private bridge: Pick<BridgeService, 'startPopupWatch' | 'stopPopupWatch' | 'popupNotifications' | 'readPopupSubscription'>,
    private showToolbarDot: (hasUnread: boolean) => void
  ) {}

  private async account(): Promise<PopupAccount | null> {
    if (!(await this.session.hasSession())) return null
    const token = await this.session.getToken()
    if (!token) return null
    const [userKey] = getTokenIdentityKeys(token)
    const accountKey = await getSessionAccountKey(token)
    if (!userKey || !accountKey) return null
    return { userKey, storageKey: `popup-inbox:${new URL(process.env.PUBLIC_BASE_URL || '').origin}:${accountKey}` }
  }

  private async state(account: PopupAccount): Promise<PopupSaveState | undefined> {
    return (await browser.storage.local.get(account.storageKey))[account.storageKey] as PopupSaveState | undefined
  }

  private write(account: PopupAccount, update: (old: PopupSaveState | undefined) => PopupSaveState | undefined) {
    const next = this.writes.then(async () => {
      if ((await this.account())?.storageKey !== account.storageKey) return false
      const old = await this.state(account)
      const updated = update(old)
      if (!updated) return false
      if (old !== updated) await browser.storage.local.set({ [account.storageKey]: updated })
      return true
    })
    this.writes = next.catch(() => undefined)
    return next
  }

  async inbox(checkpoint: PopupBookmarkCheckpoint) {
    const account = await this.account()
    if (!account || checkpoint.userKey !== account.userKey) return
    if (await this.write(account, old => clearPopupInbox(old, checkpoint))) this.refresh()
  }

  refresh(watchId?: string) {
    if (watchId && watchId !== TOOLBAR_WATCH_ID) return
    this.dirty = true
    if (this.checking) return
    this.dirty = false
    this.checking = true
    const generation = this.generation
    void this.read(generation).catch(() => {
      if (this.generation === generation) this.publish({ state: 'unavailable' })
    }).finally(() => {
      this.checking = false
      if (this.dirty) this.refresh()
    })
  }

  reset() {
    this.generation++
    this.watching = false
    this.publish({ state: 'loading' })
  }

  private publish(result: PopupNotificationResult, account: PopupAccount | null = null) {
    this.showToolbarDot(result.state === 'ready' && result.items.length > 0)
    this.listeners.forEach(listener => listener(result, account))
  }

  private async read(generation: number) {
    const account = await this.account()
    if (this.generation !== generation) return
    if (!account) {
      this.publish({ state: 'signed-out' })
      return
    }
    if (!this.watching) {
      const started = await this.bridge.startPopupWatch(TOOLBAR_WATCH_ID)
      if (this.generation !== generation) {
        if (started) await this.bridge.stopPopupWatch(TOOLBAR_WATCH_ID)
        return
      }
      if (!started) {
        this.publish({ state: 'unavailable' })
        return
      }
      this.watching = true
    }

    let state = await this.state(account)
    let result = await this.bridge.popupNotifications(account.userKey, state)
    if (this.generation !== generation || (await this.account())?.storageKey !== account.storageKey) return
    if (result?.checkpoint && !state) {
      const checkpoint = result.checkpoint
      if (await this.write(account, old => old ?? clearPopupInbox(undefined, { ...checkpoint, seenAt: Math.min(this.startedAt, checkpoint.seenAt) }))) {
        state = await this.state(account)
        result = await this.bridge.popupNotifications(account.userKey, state)
      }
    }
    if ((await this.account())?.storageKey !== account.storageKey || this.generation !== generation) return

    if (!result) {
      this.watching = false
      this.publish({ state: 'unavailable' })
    } else if (!result.hasSynced || result.userKey !== account.userKey || !result.subscriptions || !result.saves) {
      this.publish({ state: 'loading' })
    } else {
      this.publish({ state: 'ready', items: selectPopupNotifications(result.subscriptions, result.saves) }, account)
    }
  }

  connect(port: Browser.runtime.Port, checkLogin: (unauthorizedToken?: string) => Promise<boolean>) {
    let closed = false
    let items: PopupNotification[] = []
    let displayedAccount: PopupAccount | null = null

    const disconnect = () => {
      closed = true
      this.listeners.delete(send)
    }
    const send: PopupListener = (result, account) => {
      displayedAccount = account
      items = result.state === 'ready' ? result.items : []
      try {
        port.postMessage(result)
      } catch {
        disconnect()
      }
    }

    this.listeners.add(send)
    port.onDisconnect.addListener(disconnect)
    port.onMessage.addListener(message => {
      if (message?.method !== 'open' || typeof message.id !== 'string') return
      const item = items.find(candidate => candidate.id === message.id && candidate.kind === message.kind)
      const account = displayedAccount
      const respond = (ok: boolean) => { if (!closed) port.postMessage({ method: 'opened', ok }) }
      void (async () => {
        if (!(await checkLogin())) return true
        if (!item || !account) return false
        let selected = item
        if (item.kind === 'subscription') {
          const throughAt = message.throughAt
          if (typeof throughAt !== 'string' || !Number.isFinite(Date.parse(throughAt)) || Date.parse(throughAt) > Date.parse(item.throughAt)) return false
          selected = { ...item, throughAt }
        }
        const token = await this.session.getToken()
        const opened = await this.open(account, selected)
        if (opened === 'auth-required') return !(await checkLogin(token ?? undefined))
        return opened || !(await checkLogin())
      })().then(respond).catch(() => respond(false)).finally(() => this.refresh())
    })
    this.refresh()
  }

  private async open(account: PopupAccount, item: PopupNotification): Promise<boolean | 'auth-required'> {
    if ((await this.account())?.storageKey !== account.storageKey) return false
    const saved = item.kind === 'save'
      ? await this.write(account, state => state && dismissPopupSave(state, item.id))
      : await this.bridge.readPopupSubscription(account.userKey, item.id, item.throughAt)
    if (saved === 'auth-required') return saved
    if (!saved || (await this.account())?.storageKey !== account.storageKey) return false
    const path = item.kind === 'save' ? 'b' : 'c'
    await browser.tabs.create({ url: new URL(`/${path}/${encodeURIComponent(item.id)}`, process.env.PUBLIC_BASE_URL).href })
    return true
  }
}
