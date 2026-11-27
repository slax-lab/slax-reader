import { ACTION_POPUP_PORT, type ActionPopupBookmark, BookmarkActionType, type BookmarkLookupResult, MessageTypeAction } from '@/config/message'

import { setExtensionLocale } from '@/utils/locale'
import { ACCOUNT_LOCALE_KEY, normalizeBrowserLocale } from '@/utils/localeCore'
import { isLocaleSender } from '@/utils/localeRelay'

import { ensureLocaleCalibrationAlarm } from './localeAlarm'
import { readLocaleUserInfo } from './localeApi'
import { LocaleService } from './localeService'
import { expireLocaleSession } from './localeSessionExpiry'
import { PopupNotifications } from './popupNotifications'
import { AuthService } from '@/entrypoints/background/authService'
import { BridgeService, canUseBridgeState } from '@/entrypoints/background/bridgeService'
import { BrowserService, logTabMessageError } from '@/entrypoints/background/browserService'
import { CONFIG } from '@/entrypoints/background/config'
import { MessageHandler } from '@/entrypoints/background/messageHandler'
import { MetricService } from '@/entrypoints/background/metricService'
import { getSessionAccountKey, getTokenIdentityKeys, SessionService, userInfoMatchesIdentity } from '@/entrypoints/background/sessionService'
import { StorageService } from '@/entrypoints/background/storageService'
import { isPopupInboxPath, type PopupBookmarkCheckpoint } from '@commons/frontend-types/frontend'
import type { MetricActionType } from '@slax-reader/contracts/analytics'
import type { UserInfo } from '@slax-reader/contracts/interface'

export default defineBackground(() => {
  const storageService = new StorageService()
  const sessionService = new SessionService()
  let sessionTransition: Promise<void> = Promise.resolve()
  const enqueueSessionTransition = (task: () => Promise<void>) => {
    sessionTransition = sessionTransition.then(task).catch(error => {
      console.warn('[session] transition failed:', error)
    })
    return sessionTransition
  }
  const bridgeService = new BridgeService(sessionService, () => sessionTransition)
  const metricService = new MetricService(sessionService)
  const popupNotifications = new PopupNotifications(sessionService, bridgeService, visible => BrowserService.setToolbarNotificationDot(visible))
  const popupUrl = browser.runtime.getURL('/popup.html')
  const syncActionPopup = async () => {
    await browser.action.setPopup({ popup: (await sessionService.hasSession()) ? popupUrl : '' })
  }
  const isPopup = (sender: Browser.runtime.MessageSender | undefined) => sender?.id === browser.runtime.id && sender.url === popupUrl && !sender.tab
  browser.runtime.onConnect.addListener(port => {
    if (port.name === ACTION_POPUP_PORT && isPopup(port.sender)) popupNotifications.connect(port, checkPopupLogin)
  })

  const expireSession = (expectedToken?: string): Promise<void> => {
    popupNotifications.reset()
    return enqueueSessionTransition(async () => {
      await expireLocaleSession(
        {
          session: sessionService,
          invalidateLocale: () => localeService.invalidateSession(null),
          clearUserData: () => storageService.clearUserData(),
          teardown: () => bridgeService.teardown(),
          recalibrate: () => refreshLocale('session')
        },
        expectedToken
      )
      await syncActionPopup()
    }).then(() => popupNotifications.refresh())
  }
  setExtensionLocale(normalizeBrowserLocale(browser.i18n.getUILanguage()))
  const localeService = new LocaleService({
    readSession: async () => {
      const token = await sessionService.getToken()
      if (!token || !(await sessionService.hasSession())) return null
      const accountKey = await getSessionAccountKey(token)
      return accountKey ? { token, accountKey, identityKeys: getTokenIdentityKeys(token) } : null
    },
    readStored: async () => (await browser.storage.local.get(ACCOUNT_LOCALE_KEY))[ACCOUNT_LOCALE_KEY],
    writeStored: snapshot => browser.storage.local.set({ [ACCOUNT_LOCALE_KEY]: snapshot }),
    readUserInfo: readLocaleUserInfo,
    expireSession,
    onSnapshot: snapshot => {
      setExtensionLocale(snapshot.locale)
      void BrowserService.updateContextMenuLocale().catch(error => console.warn('[locale] menus failed', error))
    },
    browserLocale: () => browser.i18n.getUILanguage(),
    now: () => Date.now()
  })
  const refreshLocale = (reason: Parameters<LocaleService['refresh']>[0]) => {
    void localeService.refresh(reason).catch(error => console.warn('[locale] refresh failed', error))
  }
  void localeService
    .initialize()
    .then(() => refreshLocale('startup'))
    .catch(error => console.warn('[locale] initialization failed', error))
  void ensureLocaleCalibrationAlarm().catch(error => console.warn('[locale] alarm initialization failed', error))

  let loginInFlight: Promise<void> | null = null
  const requireLogin = (expectedToken?: string) => {
    if (loginInFlight) return loginInFlight
    loginInFlight = expireSession(expectedToken)
      .then(async () => {
        if (expectedToken && (await sessionService.hasSession())) return
        const loginUrl = `${process.env.PUBLIC_BASE_URL}/login?from=extension`
        const existing = (await browser.tabs.query({})).find(tab => tab.url === loginUrl)
        if (existing?.id) {
          await browser.tabs.update(existing.id, { active: true })
        } else {
          await browser.tabs.create({ url: loginUrl })
        }
      })
      .finally(() => {
        loginInFlight = null
      })
    return loginInFlight
  }
  const CHECKUP_MIN_INTERVAL_MS = 3 * 60 * 1000
  let lastCheckupAt = 0
  let checkupInFlight: Promise<boolean> | null = null
  let forcedCheckupQueued = false

  let lastSessionIdentity = ''
  const initialSessionIdentity = sessionService.getToken().then(token => {
    lastSessionIdentity = [...getTokenIdentityKeys(token)][0] || ''
  })

  // 'not-ready' = 既没同步完也没本地数据，无法区分"确实没有"和"同步刚开始、数据还没落地"，
  // 因此任何时候都不可信；只有 'local'（本地已有数据）和真正 'synced' 过才可信。
  // 最终"确实没有任何书签"会随首次同步跑完变成 hasSynced=true 的 'synced'，不需要靠 not-ready 兜底。
  const bridgeTransportMatches = async (state: Parameters<typeof canUseBridgeState>[0]): Promise<boolean> => {
    const expectedUserKeys = getTokenIdentityKeys(await sessionService.getToken())
    if (!expectedUserKeys.size) return false
    const actualUserKey = state.userKey?.replace(/^"|"$/g, '') || ''
    if (!actualUserKey) return false
    if (!expectedUserKeys.has(actualUserKey)) return false

    return state.state === 'local' || (state.state === 'synced' && state.hasSynced)
  }

  const userInfoMatchesSession = async (userInfo: UserInfo) => {
    const identities = getTokenIdentityKeys(await sessionService.getToken())
    return userInfoMatchesIdentity(userInfo, identities)
  }

  // offscreen bridge 转发的 PowerSync 同步状态广播（见 offscreen/main.ts 的 powersync-status）。
  // 用于把"死等固定超时"换成"同步真的有进展/完成时才重查"。
  type PowerSyncStatusSnapshot = {
    connected: boolean
    connecting: boolean
    downloading: boolean
    uploading: boolean
    hasSynced: boolean
    lastSyncedAt: string | null
    downloadError: string | null
    uploadError: string | null
  }
  let lastPowerSyncStatus: PowerSyncStatusSnapshot | null = null
  let syncStatusWaiters: Array<(status: PowerSyncStatusSnapshot) => void> = []
  const onPowerSyncStatusChanged = (status: PowerSyncStatusSnapshot) => {
    lastPowerSyncStatus = status
    const waiters = syncStatusWaiters
    syncStatusWaiters = []
    waiters.forEach(resolve => resolve(status))
  }
  // 等待下一次同步状态广播，超时则返回当前已知的最新状态（可能仍是旧的，由调用方决定要不要再等）
  const waitForNextSyncStatus = (timeoutMs: number): Promise<PowerSyncStatusSnapshot | null> =>
    new Promise(resolve => {
      const timer = setTimeout(() => {
        syncStatusWaiters = syncStatusWaiters.filter(waiter => waiter !== onTimeout)
        resolve(lastPowerSyncStatus)
      }, timeoutMs)
      const onTimeout = (status: PowerSyncStatusSnapshot) => {
        clearTimeout(timer)
        resolve(status)
      }
      syncStatusWaiters.push(onTimeout)
    })

  const authService = new AuthService(sessionService, requireLogin, () => bridgeService.userInfo(), userInfoMatchesSession)
  const checkPopupLogin = async (unauthorizedToken?: string) => {
    await sessionTransition
    if (!unauthorizedToken) return authService.checkLogin()
    await requireLogin(unauthorizedToken)
    return sessionService.hasSession()
  }
  const messageHandler = new MessageHandler(authService)

  const queryBookmarkRef = async (url: string): Promise<BookmarkLookupResult> => {
    if (!(await sessionService.hasSession())) return { bookmarkUid: null, bridgeReady: false, bookmark: null }
    const lookup = await bridgeService.lookup(url)
    const identityMatched = lookup ? await bridgeTransportMatches(lookup) : false
    if (lookup && identityMatched) {
      return { bookmarkUid: lookup.bookmark?.uuid ?? null, bridgeReady: true, bookmark: lookup.bookmark }
    }

    return { bookmarkUid: null, bridgeReady: false, bookmark: null }
  }

  type PopupSaveResponse = { ok: boolean; operation?: string; bookmark?: ActionPopupBookmark; labMessage?: string }
  type PopupSaveReceipt = { url: string; account: string }
  const popupSaves = new Map<string, Promise<PopupSaveResponse>>()
  const receiptKey = (tabId: number) => `slax:action-popup-save:${tabId}`
  const submissionKey = (tabId: number, url: string, account: string | null) => JSON.stringify([tabId, url, account])

  const hasSaveReceipt = async (tabId: number, url: string, account: string | null) => {
    if (!account) return false
    const key = receiptKey(tabId)
    const receipt = (await browser.storage.session.get(key))[key] as PopupSaveReceipt | undefined
    return receipt?.url === url && receipt.account === account
  }

  const readPopupBookmark = async (tabId: number, url: string, account: string | null): Promise<ActionPopupBookmark | undefined> => {
    if (!/^https?:\/\//.test(url)) return { state: 'unsaved' }
    if (popupSaves.has(submissionKey(tabId, url, account))) return { state: 'saving' }
    const acknowledged = await hasSaveReceipt(tabId, url, account)
    const lookup = await queryBookmarkRef(url)
    if (lookup.bookmark) {
      const { readable, status, uuid } = lookup.bookmark
      const canOpen = readable ?? (status === 'success')
      if (canOpen || status === 'failed') {
        if (acknowledged) await browser.storage.session.remove(receiptKey(tabId))
        return canOpen ? { state: 'readable', id: uuid } : { state: 'unsaved' }
      }
      return { state: 'saved' }
    }
    if (acknowledged) return { state: 'saved' }
    if (lookup.bridgeReady) return { state: 'unsaved' }
  }

  const updateTabBookmarkStatus = async (tabId: number, url: string) => {
    const bookmarkRef = await queryBookmarkRef(url)
    await browser.action.setBadgeText({ text: bookmarkRef.bookmarkUid ? '✓' : '', tabId })
  }

  const refreshOpenTabs = async () => {
    const tabs = await browser.tabs.query({})
    await Promise.allSettled(
      tabs.map(async tab => {
        if (!tab.id || !tab.url || tab.status !== 'complete' || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) return
        await updateTabBookmarkStatus(tab.id, tab.url)
        await BrowserService.notifyBookmarkStatusUpdate(tab)
      })
    )
  }

  // 首次查询立即执行；命中就直接结束（跟原来一样），未命中时不再按固定间隔盲猜，
  // 而是等"下一次同步状态广播"（真实进度）或一个更宽松的兜底上限，谁先到就再查一次。
  // 兜底上限调宽是因为 offscreen bridge 冷启动同步本身可能就要好几秒到十几秒，
  // 3 秒的老预算在没有其它 r.slax.com 上下文预热时基本必然超时（详见修复记录）。
  const BOOKMARK_VISIBLE_STEP_TIMEOUT_MS = 2_000
  const BOOKMARK_VISIBLE_TOTAL_TIMEOUT_MS = 25_000

  // 书签同步落地有延迟，等真实同步进展直到状态符合预期（或兜底超时）
  // 删除时等它消失，避免面板等不到刷新通知
  const notifySenderTabWhenReady = async (tab: Browser.tabs.Tab, actionType?: BookmarkActionType) => {
    if (!tab.id || !tab.url) return
    const tabId = tab.id
    const url = tab.url
    const expectPresent = actionType !== BookmarkActionType.DELETE
    const deadline = Date.now() + BOOKMARK_VISIBLE_TOTAL_TIMEOUT_MS

    while (true) {
      const bookmarkRef = await queryBookmarkRef(url)
      if (Boolean(bookmarkRef.bookmarkUid) === expectPresent) break
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await waitForNextSyncStatus(Math.min(BOOKMARK_VISIBLE_STEP_TIMEOUT_MS, remaining))
    }

    // 避免重试期间切换页面
    // 结果写到旧 tab 上
    const currentTab = await browser.tabs.get(tabId).catch(() => null)
    if (!currentTab || currentTab.url !== url) return

    await updateTabBookmarkStatus(tabId, url)
    await BrowserService.notifyBookmarkStatusUpdate(tab)
  }

  const refreshBookmarkSource = async (): Promise<boolean> => {
    const status = await bridgeService.status()
    if (status?.ok && status.hasBookmarkTable && (await bridgeTransportMatches(status))) {
      await refreshOpenTabs()
      return true
    }
    return false
  }

  const changesCheckup = (force = false): Promise<boolean> => {
    if (!checkupInFlight && !force && Date.now() - lastCheckupAt < CHECKUP_MIN_INTERVAL_MS) return Promise.resolve(true)
    if (checkupInFlight) {
      if (force) forcedCheckupQueued = true
      return checkupInFlight
    }
    forcedCheckupQueued = true
    const run = async () => {
      let success = true
      while (forcedCheckupQueued) {
        forcedCheckupQueued = false
        success = (await sessionService.hasSession()) && (await refreshBookmarkSource())
        if (success) lastCheckupAt = Date.now()
      }
      return success
    }
    checkupInFlight = run().finally(() => {
      checkupInFlight = null
    })
    return checkupInFlight
  }

  void storageService.clearUserData()
  void enqueueSessionTransition(syncActionPopup)
  popupNotifications.refresh()
  sessionService.hasSession().then(hasSession => {
    if (hasSession) void changesCheckup()
  })

  // 监听cookie变化

  const cookieHost = process.env.COOKIE_DOMAIN as string
  browser.cookies.onChanged.addListener(changeInfo => {
    const { domain, name } = changeInfo.cookie
    const allowedDomains = [cookieHost, `.${cookieHost}`]

    if (!allowedDomains.includes(domain) || name !== process.env.COOKIE_TOKEN_NAME) {
      return
    }

    if (changeInfo.removed) {
      if (changeInfo.cause !== 'overwrite') {
        popupNotifications.reset()
        void localeService.invalidateSession(null).catch(error => console.warn('[locale] reset failed', error))
        void enqueueSessionTransition(async () => {
          await syncActionPopup()
          await Promise.allSettled([storageService.clearUserData(), bridgeService.teardown()])
        }).then(() => popupNotifications.refresh())
      }
      return
    }

    const currentIdentity = [...getTokenIdentityKeys(changeInfo.cookie.value)][0] || ''
    if (currentIdentity !== lastSessionIdentity) popupNotifications.reset()
    void enqueueSessionTransition(async () => {
      await syncActionPopup()
      await initialSessionIdentity
      const sameUser = Boolean(currentIdentity && currentIdentity === lastSessionIdentity)
      lastSessionIdentity = currentIdentity
      if (!sameUser) {
        popupNotifications.reset()
        await Promise.allSettled([localeService.invalidateSession(await getSessionAccountKey(changeInfo.cookie.value)), storageService.clearUserData(), bridgeService.teardown()])
      }
    }).then(async () => {
      popupNotifications.refresh()
      refreshLocale('session')
      if (!(await sessionService.hasSession())) return
      await changesCheckup(true)
    })
  })

  const bridgeUrl = new URL('/x/ext-bridge', process.env.PUBLIC_BASE_URL || `https://${cookieHost}`).href
  browser.webRequest.onCompleted.addListener(
    details => {
      if (details.statusCode === 401) void expireSession()
    },
    { urls: [`${bridgeUrl}*`], types: ['sub_frame'] }
  )

  // listen network change
  if ('connection' in navigator) {
    let lastStatus: 'online' | 'offline' = navigator.onLine ? 'online' : 'offline'
    // only Blink/Chromium based browsers support various parts of the NetworkInformation interface
    // https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation#browser_compatibility
    // so we just can use ts-ignore here
    //@ts-ignore
    navigator.connection.addEventListener('change', (e: Event) => {
      const connection = e.currentTarget as EventTarget & {
        effectiveType?: string
        rtt?: number
        downlink?: number
        saveData?: boolean
        type?: string
      }
      let networkStatus = 'online'
      if (connection.rtt === 0 || !navigator.onLine) {
        networkStatus = 'offline'
      }
      if (networkStatus !== lastStatus) {
        console.log('[network] status changed:', {
          from: lastStatus,
          to: networkStatus,
          effectiveType: connection.effectiveType,
          rtt: connection.rtt,
          downlink: connection.downlink,
          online: navigator.onLine
        })
        if (networkStatus === 'online') {
          refreshLocale('online')
          void changesCheckup(true)
        }
      }
      lastStatus = networkStatus as 'online' | 'offline'
    })
  } else {
    console.log('navigator.connection is not supported')
  }

  // 监听插件安装事件
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    await BrowserService.resetContentScripts()
    if (reason === 'install') {
      void BrowserService.activateContentScripts().catch(() => console.warn('[install] collector activation failed'))
    }
    BrowserService.setupBadge()
    await BrowserService.registerContextMenus()

    await ensureLocaleCalibrationAlarm()

    console.log(`Extension installed, reason: ${reason}, browser: ${import.meta.env.BROWSER}`)
    console.log(`Runtime: ${!!browser.runtime} \nCookie: ${!!browser.cookies} \nTabs: ${!!browser.tabs} \nContextMenus: ${!!browser.contextMenus} \nAction: ${!!browser.action}`)

    if (!(await sessionService.hasSession())) {
      reason === 'install' && BrowserService.openTab(`${process.env.PUBLIC_BASE_URL}/guide?from=extension`)
    } else {
      await changesCheckup(true)
    }

    analytics.setEnabled(true)
  })

  // 监听定时任务
  browser.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === CONFIG.BOOKMARK_RECORDS_SYNC_KEY) {
      refreshLocale('alarm')
      changesCheckup(true)
    }
  })

  // 设置卸载反馈URL
  const uninstallUrl = process.env.UNINSTALL_FEEDBACK_URL
  if (uninstallUrl) {
    browser.runtime.setUninstallURL(uninstallUrl)
  }

  // 菜单点击事件处理
  const menuActions: Record<string, (info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) => void> = {
    setting: () => BrowserService.openSetting(authService),
    shortcutKeySetting: () => BrowserService.openTab('chrome://extensions/shortcuts'),
    collectList: () => BrowserService.openTab(`${process.env.PUBLIC_BASE_URL}/bookmarks`),
    index: () => BrowserService.openTab(`${process.env.PUBLIC_BASE_URL}`),
    collect: async (info, tab) => {
      refreshLocale('open')
      // track() checks the session itself, so the heartbeat does not need the login gate that PDF dispatch removed.
      void metricService.track().catch(error => console.warn('[collect] metric failed:', error))
      tab && BrowserService.openCollectPopup(tab, 'open_collect', authService)
    }
  }

  // 监听菜单点击事件
  browser.contextMenus.onClicked.addListener((info, tab) => {
    const action = menuActions[info.menuItemId]
    if (action) {
      action(info, tab)
    }
  })

  browser.action.onClicked.addListener(tab => {
    void (async () => {
      if (!(await checkPopupLogin())) return
      // The click can race the cookie event that restores the native popup.
      await enqueueSessionTransition(syncActionPopup)
      await browser.action.openPopup?.(tab.windowId == null ? undefined : { windowId: tab.windowId })
    })().catch(error => console.warn('[popup] action failed:', error))
  })

  BrowserService.watchPinnedStatusChanges()

  // 监听其他页面发送的消息
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target === 'action-popup' && isPopup(sender)) {
      if (!['open', 'open-inbox', 'bookmark-state', 'open-bookmark', 'save'].includes(message.method)) return false
      void (async () => {
        if (message.method === 'bookmark-state') {
          await sessionTransition
          if (!(await sessionService.hasSession())) return { ok: false }
        } else if (!(await checkPopupLogin())) return { ok: true, redirected: true }
        if (message.method === 'open') return { ok: true }
        if (message.method === 'open-inbox') {
          await browser.tabs.create({ url: new URL('/bookmarks', process.env.PUBLIC_BASE_URL).href })
          return { ok: true }
        }
        if (typeof message.tabId !== 'number' || typeof message.url !== 'string') return { ok: false }
        const { tabId, url } = message as { tabId: number; url: string }
        const tab = await browser.tabs.get(tabId)
        if (tab.url !== url) return { ok: false }
        const token = await sessionService.getToken()
        if (!token) {
          if (message.method !== 'bookmark-state' && !(await checkPopupLogin())) return { ok: true, redirected: true }
          return { ok: false }
        }
        const account = await getSessionAccountKey(token)
        if (message.method === 'bookmark-state' || message.method === 'open-bookmark') {
          const bookmark = await readPopupBookmark(tabId, url, account)
          if (message.method === 'bookmark-state') return { ok: true, bookmark }
          if (bookmark?.state !== 'readable') {
            if (!(await checkPopupLogin())) return { ok: true, redirected: true }
            return { ok: false, bookmark }
          }
          await browser.tabs.create({ url: new URL(`/b/${encodeURIComponent(bookmark.id)}`, process.env.PUBLIC_BASE_URL).href })
          return { ok: true }
        }

        const key = submissionKey(tabId, url, account)
        const existing = popupSaves.get(key)
        if (existing) return existing
        const save = (async (): Promise<PopupSaveResponse> => {
          if (await hasSaveReceipt(tabId, url, account)) return { ok: true, bookmark: { state: 'saved' } }
          refreshLocale('open')
          void metricService.track().catch(error => console.warn('[collect] metric failed:', error))
          let operation: string | undefined
          const submission = await BrowserService.openCollectPopup(tab, 'open_collect', authService, async source => {
            const { initializePdfAction } = await import('./pdfOperations')
            const result = await initializePdfAction(source)
            if (typeof result.operation !== 'string') throw new Error('PDF source is no longer current')
            operation = result.operation
          })
          if (!submission) return { ok: true, operation }
          if (!submission.accepted) return { ok: false, labMessage: submission.labMessage }
          if (account && (await browser.tabs.get(tabId).catch(() => undefined))?.url === url) {
            await browser.storage.session.set({ [receiptKey(tabId)]: { url, account } satisfies PopupSaveReceipt })
              .catch(() => console.warn('[popup] could not store the save receipt'))
          }
          return { ok: true, bookmark: { state: 'saved' } }
        })().finally(() => {
          popupSaves.delete(key)
          popupNotifications.refresh()
        })
        popupSaves.set(key, save)
        return save
      })().then(sendResponse).catch(() => sendResponse({ ok: false }))
      return true
    }
    if (message?.target === 'slax-background' && message.method === 'popup-inbox-checkpoint') {
      if (!isLocaleSender(sender, browser.runtime.id, process.env.PUBLIC_BASE_URL || '') || !isPopupInboxPath(new URL(sender.url!).pathname)) return false
      void popupNotifications.inbox(message.checkpoint as PopupBookmarkCheckpoint)
        .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }))
      return true
    }
    if (message?.target === 'slax-background' && message.method === 'popup-notifications-changed') {
      if (sender.id === browser.runtime.id && sender.url === browser.runtime.getURL('/offscreen.html') && !sender.tab && typeof message.watchId === 'string') {
        popupNotifications.refresh(message.watchId)
      }
      return false
    }
    if (message?.target === 'pdf-save') {
      void import('./pdfOperations').then(async ({ pdfOperationMessage, trustedPdfAction, initializePdfAction }) => {
        if (message.method === 'initialize') {
          if (!trustedPdfAction(sender) || Object.keys(message).some(key => !['target', 'method'].includes(key))) { sendResponse({ error: 'source' }); return }
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
          if (!tab) { sendResponse({ error: 'source' }); return }
          refreshLocale('open')
          if (tab.url?.startsWith('file:') && !(await browser.extension.isAllowedFileSchemeAccess())) {
            sendResponse(await initializePdfAction(tab))
          } else {
            await BrowserService.openCollectPopup(tab, 'open_collect', authService)
            sendResponse({ ok: true, inline: true })
          }
          return
        }
        const result = await pdfOperationMessage(message, sender)
        if (result.ok && message.method === 'complete') void changesCheckup(true)
        sendResponse(result)
      }).catch(() => sendResponse({ error: 'source' }))
      return true
    }
    const receiveMessage = message as {
      action?: string
      actionType?: MetricActionType | BookmarkActionType
      target?: string
      method?: string
      version?: number
      url?: string
      operation?: 'create' | 'delete'
      body?: Record<string, unknown>
      status?: Record<string, unknown>
    }

    if (receiveMessage.target === 'slax-background' && receiveMessage.method === 'get-account-locale') {
      if (sender.id !== browser.runtime.id) return false
      void localeService
        .getSnapshot()
        .then(snapshot => sendResponse({ success: true, snapshot }))
        .catch(() => sendResponse({ success: false }))
      return true
    }
    if (receiveMessage.target === 'slax-background' && receiveMessage.method === 'invalidate-account-locale') {
      if (receiveMessage.version !== 1 || !isLocaleSender(sender, browser.runtime.id, process.env.PUBLIC_BASE_URL || '')) return false
      refreshLocale('user-save')
      sendResponse({ success: true })
      return false
    }

    if (receiveMessage.target === 'slax-background' && receiveMessage.method === 'bridge-session') {
      if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL('/offscreen.html') || sender.tab) return false
      void (async () => {
        await sessionTransition
        const token = (await sessionService.hasSession()) ? await sessionService.getToken() : null
        sendResponse({ success: true, token })
      })().catch(() => sendResponse({ success: false }))
      return true
    }

    if (receiveMessage.target === 'slax-background' && receiveMessage.method === 'current-session-token') {
      Promise.all([sessionService.getToken(), getExtensionDeviceId()])
        .then(([token, deviceId]) => sendResponse({ success: true, token, deviceId }))
        .catch(error => sendResponse({ success: false, error: String(error) }))
      return true
    }

    if (receiveMessage.target === 'slax-background' && receiveMessage.method === 'collect-screen-viewed') {
      eventLog({ event_name: 'screen_viewed', properties: { screen_name: 'extension_save' } }).then(() => sendResponse({ success: true }))
      return true
    }

    if (receiveMessage.target === 'slax-background' && receiveMessage.method === 'session-expired') {
      expireSession()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: String(error) }))
      return true
    }

    if (receiveMessage.target === 'slax-background' && receiveMessage.method === 'interactive-auth-required') {
      requireLogin()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: String(error) }))
      return true
    }

    if (receiveMessage.target === 'slax-background' && receiveMessage.method === 'powersync-status') {
      console.log('[powersync] connection status changed:', receiveMessage.status)
      const status = receiveMessage.status as unknown as PowerSyncStatusSnapshot
      const wasSynced = lastPowerSyncStatus?.hasSynced
      onPowerSyncStatusChanged(status)
      if (wasSynced !== status.hasSynced) popupNotifications.refresh()
      return false
    }

    if (receiveMessage.action === MessageTypeAction.ContentScriptReady) {
      if (sender.tab?.id) BrowserService.markContentScriptReady(sender.tab.id)
      return false
    }

    if (receiveMessage.target === 'slax-background' && receiveMessage.method === 'bridge-mark') {
      const operation = receiveMessage.operation
      ;(async () => {
        if (!(await sessionService.hasSession())) {
          sendResponse({ success: false, authRequired: true })
          return
        }

        const task =
          operation === 'create'
            ? bridgeService.createMark(receiveMessage.body || {})
            : operation === 'delete' && typeof receiveMessage.body?.mark_uid === 'string'
              ? bridgeService.deleteMark(receiveMessage.body.mark_uid)
              : Promise.reject(new Error('invalid bridge mark request'))
        try {
          const data = await task
          sendResponse({ success: Boolean(data), data })
        } catch (error) {
          await sessionTransition
          if (!(await sessionService.hasSession())) {
            sendResponse({ success: false, authRequired: true })
          } else {
            sendResponse({ success: false, error: String(error) })
          }
        }
      })()
      return true
    }

    if (receiveMessage.action === MessageTypeAction.QueryBookmarkChange && receiveMessage.url) {
      queryBookmarkRef(receiveMessage.url)
        .then(bookmark => sendResponse({ success: true, data: bookmark }))
        .catch(error => sendResponse({ success: false, data: String(error) }))
      return true
    }

    if (receiveMessage.action === MessageTypeAction.RecordBookmark) {
      void changesCheckup(true)
      if (sender.tab) {
        if (sender.tab.id) BrowserService.markContentScriptReady(sender.tab.id)
        void notifySenderTabWhenReady(sender.tab, receiveMessage.actionType as BookmarkActionType | undefined)
      }
      return false
    }

    if (receiveMessage.action === MessageTypeAction.TrackDashboardMetric) {
      metricService.track(receiveMessage.actionType as MetricActionType | undefined)
      return false
    }

    return messageHandler.handleMessage(message, sendResponse)
  })

  // 监听标签页更新
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' || changeInfo.url) {
      void import('./pdfOperations').then(({ invalidatePdfSource }) => invalidatePdfSource(tabId)).catch(() => {})
    }
    if (changeInfo.status === 'loading') BrowserService.clearContentScript(tabId)
    if (tab.status !== 'complete') return

    try {
      if (!tab.url) {
        return
      }

      const url = new URL(tab.url)
      const isValid = ['http:', 'https:'].includes(url.protocol)
      if (!isValid) {
        return
      }

      const tabInfo = await browser.tabs.get(tabId)
      if (tabInfo) {
        if (!(await sessionService.hasSession())) {
          await browser.action.setBadgeText({ text: '', tabId })
          return
        }
        await updateTabBookmarkStatus(tabId, tab.url)
        await BrowserService.notifyUrlUpdate(tab, tab.url || '')
      }
    } catch (error) {
      logTabMessageError(`Error checking tab with id: ${tabId}`, error)
    }
  })

  browser.tabs.onRemoved.addListener(tabId => {
    void BrowserService.clearContentScript(tabId)
    void browser.storage.session.remove(receiptKey(tabId))
    void import('./pdfOperations').then(({ invalidatePdfSource }) => invalidatePdfSource(tabId, true)).catch(() => {})
  })
})
