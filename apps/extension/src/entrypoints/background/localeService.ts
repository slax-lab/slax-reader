import { isLocaleSnapshot, normalizeAccountLocale, normalizeBrowserLocale } from '../../utils/localeCore'

import { LocaleUnauthorizedError } from './localeApi'
import { userInfoMatchesIdentity } from './sessionService'
import type { ExtensionLocaleSnapshot, LocaleRefreshReason } from '@commons/frontend-types/locale'
import type { UserInfo } from '@slax-reader/contracts/interface'

export interface LocaleSession {
  token: string
  accountKey: string
  identityKeys: ReadonlySet<string>
}
export interface LocaleServiceDeps {
  readSession(): Promise<LocaleSession | null>
  readStored(): Promise<unknown>
  writeStored(snapshot: ExtensionLocaleSnapshot): Promise<void>
  readUserInfo(token: string, signal: AbortSignal): Promise<UserInfo>
  expireSession(expectedToken: string): Promise<void>
  onSnapshot(snapshot: ExtensionLocaleSnapshot): void
  browserLocale(): string
  now(): number
}

export class LocaleService {
  private snapshot?: ExtensionLocaleSnapshot
  private epoch = 0
  private generation = 0
  private writes: Promise<unknown> = Promise.resolve()
  private loading?: Promise<ExtensionLocaleSnapshot>
  private running?: Promise<void>
  private pending = false
  private disposed = false
  private controller?: AbortController
  private lastStarted = -Infinity
  private failedAt = -Infinity
  constructor(private deps: LocaleServiceDeps) {}

  private fallback(accountKey: string | null, previous: ExtensionLocaleSnapshot | null = this.snapshot ?? null): ExtensionLocaleSnapshot {
    return {
      version: 1,
      generation: previous?.generation ?? crypto.randomUUID(),
      revision: (previous?.revision ?? 0) + 1,
      accountKey,
      locale: normalizeBrowserLocale(this.deps.browserLocale()),
      source: 'browser',
      verifiedAt: 0
    }
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writes.then(task)
    this.writes = result.catch(() => undefined)
    return result
  }
  private async publish(snapshot: ExtensionLocaleSnapshot) {
    this.snapshot = snapshot
    this.deps.onSnapshot(snapshot)
    // Storage failure must not reject browser event handlers or erase the in-memory locale.
    await this.deps.writeStored(snapshot).catch(error => console.warn('[locale] cache write failed', error))
  }
  initialize(): Promise<ExtensionLocaleSnapshot> {
    if (!this.loading)
      this.loading = this.serial(async () => {
        const epoch = this.epoch
        const [session, stored] = await Promise.all([this.deps.readSession(), this.deps.readStored().catch(() => null)])
        if (this.disposed || epoch !== this.epoch) return this.snapshot ?? this.fallback(null)
        if (isLocaleSnapshot(stored) && stored.accountKey === (session?.accountKey ?? null)) {
          this.snapshot = stored
          this.deps.onSnapshot(stored)
        } else await this.publish(this.fallback(session?.accountKey ?? null, isLocaleSnapshot(stored) ? stored : null))
        return this.snapshot!
      }).finally(() => {
        this.loading = undefined
      })
    return this.loading
  }
  async getSnapshot(): Promise<ExtensionLocaleSnapshot> {
    await this.initialize()
    void this.refresh('open').catch(error => console.warn('[locale] refresh failed', error))
    return this.snapshot!
  }
  invalidateSession(nextAccountKey: string | null): Promise<void> {
    ++this.epoch
    ++this.generation
    this.controller?.abort()
    this.failedAt = -Infinity
    return this.serial(async () => {
      if (!this.disposed) await this.publish(this.fallback(nextAccountKey))
    })
  }
  refresh(reason: LocaleRefreshReason): Promise<void> {
    const force = !['open', 'startup'].includes(reason)
    if (this.disposed) return Promise.resolve()
    if (!force && (this.deps.now() - this.failedAt < 30_000 || (this.snapshot?.source === 'account' && this.deps.now() - this.snapshot.verifiedAt < 180_000)))
      return this.running ?? Promise.resolve()
    if (force || !this.running) {
      this.pending = true
      ++this.generation
    }
    if (!this.running)
      this.running = this.drain().finally(() => {
        this.running = undefined
      })
    return this.running
  }
  private async drain() {
    if (!this.snapshot) await this.initialize()
    while (this.pending && !this.disposed) {
      this.pending = false
      const delay = Math.max(0, this.lastStarted + 1000 - this.deps.now())
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      if (this.disposed) return
      const epoch = this.epoch,
        generation = this.generation
      const session = await this.deps.readSession()
      if (!session || epoch !== this.epoch) continue
      this.lastStarted = this.deps.now()
      const controller = new AbortController()
      this.controller = controller
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const deadline = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('Locale request cancelled')), { once: true })
          timer = setTimeout(() => controller.abort(), 5000)
        })
        const user = await Promise.race([this.deps.readUserInfo(session.token, controller.signal), deadline])
        await this.serial(async () => {
          const current = await this.deps.readSession()
          if (this.disposed || epoch !== this.epoch || generation !== this.generation || current?.accountKey !== session.accountKey || current.token !== session.token) return
          if (!userInfoMatchesIdentity(user, session.identityKeys)) return
          const locale = normalizeAccountLocale(user.lang)
          if (!locale) return
          const old = this.snapshot!
          await this.publish({
            ...old,
            accountKey: session.accountKey,
            locale,
            source: 'account',
            verifiedAt: this.deps.now(),
            revision: old.revision + Number(old.locale !== locale || old.accountKey !== session.accountKey || old.source !== 'account')
          })
          this.failedAt = -Infinity
        })
      } catch (error) {
        if (epoch === this.epoch && generation === this.generation) this.failedAt = this.deps.now()
        if (error instanceof LocaleUnauthorizedError) {
          const current = await this.deps.readSession()
          if (!this.disposed && epoch === this.epoch && current?.token === session.token) await this.deps.expireSession(session.token)
        }
      } finally {
        clearTimeout(timer)
        if (this.controller === controller) this.controller = undefined
      }
    }
  }
  dispose() {
    this.disposed = true
    this.pending = false
    ++this.epoch
    this.controller?.abort()
  }
}
