import { MessageTypeAction } from '@/config/message'

type AuthSession = { checkLogin: () => Promise<boolean> }
const CONTENT_SCRIPT_READY_TABS = 'content-script-ready-tabs'

export const logTabMessageError = (message: string, error: unknown) => {
  console.error(message, error)
}

export class BrowserService {
  static openTab(url: string): void {
    browser.tabs.create({ url })
  }

  static setupBadge(): void {
    browser.action.setBadgeBackgroundColor({ color: '#10b981' })
    browser.action.setBadgeTextColor({ color: '#fff' })
  }

  static registerContextMenus(): void {
    const menus: Browser.contextMenus.CreateProperties[] = [
      { id: 'collectList', title: i18n.t('slax_collection_list'), contexts: ['action'] },
      { id: 'collect', title: i18n.t('collect_page'), contexts: ['page'] }
    ]

    menus.forEach(item => browser.contextMenus.create(item))
  }

  // 推送置顶状态给所有标签页
  static async notifyPinnedStatusUpdate(isOnToolbar: boolean): Promise<void> {
    const message = { action: MessageTypeAction.PinnedStatusUpdate, isOnToolbar }
    const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] })

    for (const tab of tabs) {
      if (!tab.id) continue
      try {
        await browser.tabs.sendMessage(tab.id, message)
      } catch {
        // 内置页无 content script，忽略
      }
    }
  }

  // 避免 fork/社区版重复注册
  static watchPinnedStatusChanges(): void {
    // 该 API 仅新版 Chrome 支持
    if (!browser.action.onUserSettingsChanged) return

    browser.action.onUserSettingsChanged.addListener(change => {
      if (change.isOnToolbar === undefined) return
      this.notifyPinnedStatusUpdate(change.isOnToolbar)
    })
  }

  private static readonly readyTabIds = new Set<number>()
  private static readonly contentScriptReadyWaiters = new Map<number, Set<() => void>>()
  private static readyTabsTransition: Promise<void> = Promise.resolve()

  static async resetContentScripts(): Promise<void> {
    this.readyTabIds.clear()
    this.contentScriptReadyWaiters.clear()
    await this.readyTabsTransition
    await browser.storage.session.remove(CONTENT_SCRIPT_READY_TABS)
  }

  static markContentScriptReady(tabId: number): Promise<void> {
    this.readyTabIds.add(tabId)
    const waiters = this.contentScriptReadyWaiters.get(tabId)
    this.contentScriptReadyWaiters.delete(tabId)
    waiters?.forEach(resolve => resolve())
    this.readyTabsTransition = this.readyTabsTransition.then(async () => {
      const stored = await browser.storage.session.get(CONTENT_SCRIPT_READY_TABS)
      const readyTabIds = new Set<number>(Array.isArray(stored[CONTENT_SCRIPT_READY_TABS]) ? stored[CONTENT_SCRIPT_READY_TABS] : [])
      readyTabIds.add(tabId)
      await browser.storage.session.set({ [CONTENT_SCRIPT_READY_TABS]: [...readyTabIds] })
    })
    return this.readyTabsTransition
  }

  static clearContentScript(tabId: number): Promise<void> {
    this.readyTabIds.delete(tabId)
    this.readyTabsTransition = this.readyTabsTransition.then(async () => {
      const stored = await browser.storage.session.get(CONTENT_SCRIPT_READY_TABS)
      const readyTabIds = new Set<number>(Array.isArray(stored[CONTENT_SCRIPT_READY_TABS]) ? stored[CONTENT_SCRIPT_READY_TABS] : [])
      readyTabIds.delete(tabId)
      await browser.storage.session.set({ [CONTENT_SCRIPT_READY_TABS]: [...readyTabIds] })
    })
    return this.readyTabsTransition
  }

  private static async isContentScriptReady(tab: Browser.tabs.Tab): Promise<boolean> {
    if (tab.id == null || !tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) return false
    if (this.readyTabIds.has(tab.id)) return true
    await this.readyTabsTransition
    const stored = await browser.storage.session.get(CONTENT_SCRIPT_READY_TABS)
    const isReady = Array.isArray(stored[CONTENT_SCRIPT_READY_TABS]) && stored[CONTENT_SCRIPT_READY_TABS].includes(tab.id)
    if (isReady) this.readyTabIds.add(tab.id)
    return isReady
  }

  private static async waitForContentScript(tab: Browser.tabs.Tab): Promise<boolean> {
    if (tab.id == null) return false
    if (await this.isContentScriptReady(tab)) return true

    const tabId = tab.id
    let resolveReady: (() => void) | undefined
    const ready = new Promise<boolean>(resolve => {
      resolveReady = () => resolve(true)
      const waiters = this.contentScriptReadyWaiters.get(tabId) ?? new Set<() => void>()
      waiters.add(resolveReady)
      this.contentScriptReadyWaiters.set(tabId, waiters)
    })
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let active = true
    const cleanup = () => {
      active = false
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      const waiters = this.contentScriptReadyWaiters.get(tabId)
      if (!waiters || !resolveReady) return
      waiters.delete(resolveReady)
      if (!waiters.size) this.contentScriptReadyWaiters.delete(tabId)
    }

    const timeout = new Promise<boolean>(resolve => {
      timeoutId = setTimeout(() => {
        cleanup()
        resolve(false)
      }, 2000)
    })

    if (await this.isContentScriptReady(tab)) {
      cleanup()
      return true
    }

    // A SPA navigation can leave the existing content script alive without another ready event.
    void browser.tabs.sendMessage(tabId, { action: MessageTypeAction.ContentScriptReady })
      .then(response => {
        if (active && response?.ready === true) void this.markContentScriptReady(tabId).catch(error => logTabMessageError('[collect] readiness persistence failed:', error))
      })
      .catch(() => {})

    const result = await Promise.race([ready, timeout])
    cleanup()
    return result
  }

  static async openCollectPopup(tab: Browser.tabs.Tab, command = 'open_collect', authService: AuthSession): Promise<void> {
    if (command !== 'open_collect') return
    try {
      if (!(await authService.checkLogin())) {
        console.info('[collect] login required')
        return
      }
      if (!(await this.waitForContentScript(tab))) {
        console.warn('[collect] content script not ready', { tabId: tab.id })
        return
      }
      await browser.tabs.sendMessage(tab.id!, { action: MessageTypeAction.ShowCollectPopup })
      analytics.track('click_extension_collect')
    } catch (error) {
      logTabMessageError('[collect] failed to open popup:', error)
    }
  }

  static async openSetting(authService: AuthSession): Promise<void> {
    if (!(await authService.checkLogin())) return
    this.openTab(`${process.env.PUBLIC_BASE_URL}/user`)
  }

  static async notifyUrlUpdate(tab: Browser.tabs.Tab, url: string): Promise<void> {
    if (!(await this.isContentScriptReady(tab))) return

    try {
      await browser.tabs.sendMessage(tab.id!, { action: MessageTypeAction.PageUrlUpdate, url })
    } catch (error) {
      logTabMessageError('Error sending message to content script:', error)
    }
  }

  static async notifyBookmarkStatusUpdate(tab: Browser.tabs.Tab, bookmarkUid?: string): Promise<void> {
    if (!(await this.isContentScriptReady(tab))) return

    try {
      await browser.tabs.sendMessage(tab.id!, { action: MessageTypeAction.BookmarkStatusRefresh, bookmarkUid })
    } catch (error) {
      logTabMessageError('Error sending bookmark status to content script:', error)
    }
  }
}
