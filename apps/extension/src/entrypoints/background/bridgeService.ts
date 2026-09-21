import type { BridgeBookmarkPayload } from '@/config/message'

import type { SessionService } from './sessionService'
import type { UserInfo } from '@commons/types/interface'

/**
 * local-first 桥的 SW 侧代理。
 *
 * 职责边界：
 *  - 通过 offscreen iframe 直接查询网页的 PowerSync 数据
 *
 * 不在这里做的事：不创建 PowerSync、不定义 schema、不申请 sync token，也不把
 * 网页快照复制进扩展 IndexedDB。PowerSync 始终只运行在网页 origin。
 */

// 只能有一个 offscreen document，多处并发创建会抛 "Only a single offscreen document may be created"
const OFFSCREEN_PATH = 'offscreen.html'

export interface BridgeStatus {
  state: 'synced' | 'local' | 'not-ready'
  userKey: string | null
  hasSynced: boolean
  hasLocalData: boolean
  sync: {
    connected: boolean
    connecting: boolean
    downloading: boolean
    uploading: boolean
    hasSynced: boolean
    lastSyncedAt: string | null
    downloadError: string | null
    uploadError: string | null
  }
}

export interface BridgeLookup extends BridgeStatus {
  bookmark: BridgeBookmarkPayload | null
}

export const canUseBridgeState = (state: BridgeStatus, expectedUserKey: string): boolean =>
  state.userKey === expectedUserKey && (state.state === 'local' || (state.state === 'synced' && state.hasSynced))

export class BridgeService {
  private creating: Promise<boolean> | null = null
  private mounted = false

  constructor(
    private sessionService: SessionService,
    private waitForSessionTransition: () => Promise<void> = async () => {}
  ) {}

  private async hasDocument(): Promise<boolean> {
    // getContexts 需要 Chrome 116+；低版本回退到 clients.matchAll（SW 全局可用）
    const runtime = browser.runtime as typeof browser.runtime & {
      getContexts?: (filter: { contextTypes: string[]; documentUrls?: string[] }) => Promise<unknown[]>
    }
    const url = browser.runtime.getURL(`/${OFFSCREEN_PATH}`)

    if (typeof runtime.getContexts === 'function') {
      try {
        const contexts = await Promise.race([
          runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] }),
          new Promise<unknown[]>(resolve => setTimeout(() => resolve([]), 1_000))
        ])
        if (Array.isArray(contexts) && contexts.length > 0) return true
      } catch {}
    }

    const globalWithClients = globalThis as unknown as { clients?: { matchAll: () => Promise<Array<{ url: string }>> } }
    if (globalWithClients.clients) {
      const all = await globalWithClients.clients.matchAll()
      return all.some(c => c.url === url)
    }
    return false
  }

  private async ensureDocument(): Promise<boolean> {
    if (await this.hasDocument()) return false

    if (this.creating) return this.creating

    this.creating = (async () => {
      try {
        const offscreen = (browser as unknown as { offscreen?: { createDocument: (o: { url: string; reasons: string[]; justification: string }) => Promise<void> } }).offscreen
        if (!offscreen) throw new Error('chrome.offscreen unavailable (Firefox / old Chrome)')

        await offscreen.createDocument({
          url: OFFSCREEN_PATH,
          // IFRAME_SCRIPTING：需要嵌入并驱动一个 iframe。此 reason 不会被自动回收
          // （只有 AUDIO_PLAYBACK 有 30s 空闲上限）
          reasons: ['IFRAME_SCRIPTING'],
          justification: 'Host the Slax Reader local-first bridge to read synced bookmark state offline.'
        })
      } catch (e) {
        // 竞态下可能已被别处创建，这种报错可以忽略
        if (!String(e).includes('Only a single offscreen document')) throw e
      }
      return true
    })()

    try {
      return await this.creating
    } finally {
      this.creating = null
    }
  }

  async ensureBridge(): Promise<boolean> {
    await this.waitForSessionTransition()
    if (!(await this.sessionService.hasSession())) {
      await this.teardown()
      return false
    }

    const documentCreated = await this.ensureDocument()
    if (documentCreated) this.mounted = false

    if (!(await this.sessionService.hasSession())) {
      await this.teardown()
      return false
    }

    if (!this.mounted) {
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const res = (await browser.runtime.sendMessage({ target: 'slax-offscreen', method: 'mount' })) as { success?: boolean } | undefined
          if (res) {
            if (!res.success) return false
            this.mounted = true
            break
          }
        } catch {
          if (attempt === 19) return false
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      if (!this.mounted) return false
    }
    return true
  }

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T | null> {
    try {
      // Capability detection and offscreen creation must be inside the same
      // fallback boundary. Firefox/old Chrome has no offscreen API.
      if (!(await this.ensureBridge())) return null
      const res = (await browser.runtime.sendMessage({ target: 'slax-offscreen', method, params })) as { success?: boolean; data?: T; error?: string } | undefined
      if (!res?.success) {
        this.mounted = false
        console.warn(`[bridge] ${method} failed:`, res?.error)
        return null
      }
      return res.data ?? null
    } catch (e) {
      this.mounted = false
      console.warn(`[bridge] ${method} threw:`, e)
      return null
    }
  }

  async status() {
    return this.call<BridgeStatus & { ok: boolean; hasBookmarkTable: boolean }>('status')
  }

  async lookup(url: string) {
    return this.call<BridgeLookup>('lookup', { url })
  }

  async userInfo() {
    return this.call<UserInfo>('userInfo')
  }

  async createMark(body: Record<string, unknown>) {
    return this.call<{ mark_uid: string; root_uid: string }>('createMark', { body })
  }

  async deleteMark(markUid: string) {
    return this.call<{ ok: true }>('deleteMark', { markUid })
  }

  async teardown() {
    this.mounted = false
    try {
      if (await this.hasDocument()) {
        await browser.runtime.sendMessage({ target: 'slax-offscreen', method: 'unmount' })
        const offscreen = (browser as unknown as { offscreen?: { closeDocument: () => Promise<void> } }).offscreen
        await offscreen?.closeDocument()
      }
    } catch (e) {
      console.warn('[bridge] teardown failed:', e)
    }
  }
}
