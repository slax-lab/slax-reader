import { BookmarkActionType, type BookmarkLookupResult, MessageTypeAction } from '@/config/message'

import { AuthService } from '@/entrypoints/background/authService'
import { BridgeService, canUseBridgeState } from '@/entrypoints/background/bridgeService'
import { BrowserService, logTabMessageError } from '@/entrypoints/background/browserService'
import { CONFIG } from '@/entrypoints/background/config'
import { MessageHandler } from '@/entrypoints/background/messageHandler'
import { MetricService } from '@/entrypoints/background/metricService'
import { SessionService } from '@/entrypoints/background/sessionService'
import { StorageService } from '@/entrypoints/background/storageService'
import type { UserInfo } from '@commons/types/interface'
import type { MetricActionType } from '@commons/types-pro'

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

  const expireSession = () =>
    enqueueSessionTransition(async () => {
      await Promise.allSettled([sessionService.clearSession(), storageService.clearUserData(), bridgeService.teardown()])
    })

  let loginInFlight: Promise<void> | null = null
  const requireLogin = () => {
    if (loginInFlight) return loginInFlight
    loginInFlight = expireSession()
      .then(async () => {
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

  const getTokenIdentityKeys = (token: string | null): Set<string> => {
    if (!token) return new Set()
    try {
      const payload = token.split('.')[1]
      if (!payload) return new Set()
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
      const claims = JSON.parse(atob(padded)) as { id?: string | number; user_id?: string | number; uid?: string | number; sub?: string | number; email?: string }
      return new Set([claims.id ?? claims.user_id ?? claims.uid ?? claims.sub, claims.email].filter(value => value != null && String(value)).map(String))
    } catch {
      return new Set()
    }
  }

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
    return identities.has(String(userInfo.userId)) || identities.has(userInfo.email)
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
        void enqueueSessionTransition(async () => {
          await Promise.allSettled([storageService.clearUserData(), bridgeService.teardown()])
        })
      }
      return
    }

    void enqueueSessionTransition(async () => {
      await initialSessionIdentity
      const currentIdentity = [...getTokenIdentityKeys(changeInfo.cookie.value)][0] || ''
      const sameUser = Boolean(currentIdentity && currentIdentity === lastSessionIdentity)
      lastSessionIdentity = currentIdentity
      if (!sameUser) await Promise.allSettled([storageService.clearUserData(), bridgeService.teardown()])
    }).then(async () => {
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
        if (networkStatus === 'online') void changesCheckup(true)
      }
      lastStatus = networkStatus as 'online' | 'offline'
    })
  } else {
    console.log('navigator.connection is not supported')
  }

  // 监听插件安装事件
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    await BrowserService.resetContentScripts()
    BrowserService.setupBadge()
    BrowserService.registerContextMenus()

    await browser.alarms.create(CONFIG.BOOKMARK_RECORDS_SYNC_KEY, {
      periodInMinutes: CONFIG.SYNC_INTERVAL_MINUTES
    })

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
      const isLoggedIn = await authService.checkLogin()
      if (!isLoggedIn) {
        return
      }

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

  // 监听插件图标点击事件
  browser.action.onClicked.addListener(async tab => {
    const isLoggedIn = await authService.checkLogin()
    if (!isLoggedIn) {
      return
    }

    void metricService.track().catch(error => console.warn('[collect] metric failed:', error))
    BrowserService.openCollectPopup(tab, 'open_collect', authService)
  })

  // 监听插件置顶状态变化，推送给所有标签页（不依赖 visibilitychange）
  BrowserService.watchPinnedStatusChanges()

  // 监听快捷键
  browser.commands.onCommand.addListener((command, tab) => tab && BrowserService.openCollectPopup(tab, command, authService))

  // 监听其他页面发送的消息
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const receiveMessage = message as {
      action?: string
      actionType?: MetricActionType | BookmarkActionType
      target?: string
      method?: string
      url?: string
      operation?: 'create' | 'delete'
      body?: Record<string, unknown>
      status?: Record<string, unknown>
    }

    if (receiveMessage.target === 'slax-background' && receiveMessage.method === 'bridge-session') {
      if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL('/offscreen.html') || sender.tab) return false
      void (async () => {
        await sessionTransition
        const token = await sessionService.hasSession() ? await sessionService.getToken() : null
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
      onPowerSyncStatusChanged(receiveMessage.status as unknown as PowerSyncStatusSnapshot)
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

  browser.tabs.onRemoved.addListener(tabId => BrowserService.clearContentScript(tabId))
})
