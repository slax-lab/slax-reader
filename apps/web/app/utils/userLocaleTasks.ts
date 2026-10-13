import { AccountLocaleDisplayError, type AccountLocaleRequest, AccountLocaleStaleError, AccountLocaleUnauthorizedError } from './accountLocaleRequest'
import type { AppLocale } from '@commons/frontend-types/locale'
import type { UserInfo } from '@slax-reader/contracts/interface'

export interface LocaleUserState {
  user: UserInfo | null
  locale: string
  confirmedAccountLocale: { accountKey: string; locale: AppLocale } | null
}
interface Deps {
  api: AccountLocaleRequest
  getToken(): string | undefined
  setToken(token: string): void
  apply(locale: AppLocale): Promise<unknown>
  notify(): void
  expire(): Promise<unknown>
}
export const localeAccountIdentity = (token: string | undefined): string | null => {
  if (!token) return null
  try {
    const part = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    const c = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)))
    if (typeof c.exp === 'number' && c.exp * 1000 <= Date.now()) return null
    const id = c.id ?? c.user_id ?? c.uid ?? c.sub
    return id != null && String(id) ? `id:${id}` : typeof c.email === 'string' && c.email ? `email:${c.email}` : null
  } catch {
    return null
  }
}
const locale = (value: unknown): AppLocale | null => (value === 'en' || value === 'zh' ? value : null)
export class UserLocaleTasks {
  private account: string | null = null
  private epoch = 0
  private revision = 0
  private readId = 0
  private refreshId = 0
  private saves: Promise<unknown> = Promise.resolve()
  private display: Promise<unknown> = Promise.resolve()
  private targetId = 0
  constructor(
    private store: LocaleUserState,
    private deps: Deps
  ) {}
  capture() {
    const token = this.deps.getToken()
    const account = localeAccountIdentity(token)
    if (account !== this.account) {
      this.account = account
      ++this.epoch
      ++this.targetId
      ++this.refreshId
    }
    if (this.store.confirmedAccountLocale?.accountKey !== account) this.store.confirmedAccountLocale = null
    return { account, epoch: this.epoch, revision: this.revision, readId: this.readId, token }
  }
  private valid(ticket: ReturnType<UserLocaleTasks['capture']>) {
    const current = this.capture()
    return Boolean(ticket.account && current.account === ticket.account && current.epoch === ticket.epoch)
  }
  private async unauthorized(error: unknown, token: string): Promise<never> {
    if (error instanceof AccountLocaleUnauthorizedError && this.deps.getToken() === token) await this.deps.expire()
    throw error
  }
  local(value: string, displayOnly = false): Promise<void> {
    this.capture()
    const next = locale(value) ?? 'en',
      id = ++this.targetId,
      epoch = this.epoch
    if (!displayOnly) this.store.locale = next
    const task = this.display
      .catch(() => {})
      .then(async () => {
        if (id !== this.targetId || epoch !== this.epoch) return
        await this.deps.apply(next)
      })
    this.display = task
    return task
  }
  clear() {
    ++this.epoch
    ++this.refreshId
    ++this.targetId
    this.account = null
    this.store.user = null
    this.store.confirmedAccountLocale = null
    void this.local(this.store.locale).catch(error => console.warn('[locale] display reset failed', error))
  }
  save(value: string): Promise<void> {
    const next = locale(value)
    if (!next) return Promise.reject(new Error('Unsupported language'))
    const ticket = this.capture()
    const queuedToken = this.deps.getToken()
    const task = this.saves
      .catch(() => {})
      .then(async () => {
        if (!ticket.account && queuedToken && this.deps.getToken() === queuedToken) {
          return this.unauthorized(new AccountLocaleUnauthorizedError(), queuedToken)
        }
        if (!this.valid(ticket)) throw new AccountLocaleStaleError()
        const token = this.deps.getToken()!
        if (this.store.confirmedAccountLocale?.locale !== next) {
          try {
            await this.deps.api.saveLanguage(token, next)
          } catch (error) {
            return this.unauthorized(error, token)
          }
          if (!this.valid(ticket)) throw new AccountLocaleStaleError()
          ++this.revision
          this.store.confirmedAccountLocale = { accountKey: ticket.account!, locale: next }
          if (this.store.user) this.store.user = { ...this.store.user, lang: next }
          this.deps.notify()
        }
        const applying = this.local(next).catch(error => {
          throw new AccountLocaleDisplayError(error)
        })
        // Attach both handlers now so a display failure cannot become an unhandled rejection.
        const [result] = await Promise.allSettled([applying, this.refreshToken()])
        if (result.status === 'rejected') throw result.reason
      })
    this.saves = task
    return task
  }
  async read(): Promise<UserInfo> {
    ++this.readId
    return this.readCurrent(true)
  }
  private async readCurrent(retryOnRotation: boolean): Promise<UserInfo> {
    const ticket = this.capture(),
      token = this.deps.getToken()
    if (!token) throw new AccountLocaleStaleError()
    if (!ticket.account) return this.unauthorized(new AccountLocaleUnauthorizedError(), token)
    let user: UserInfo
    try {
      user = await this.deps.api.readUser(token)
    } catch (error) {
      return this.unauthorized(error, token)
    }
    if (!this.valid(ticket) || ticket.readId !== this.readId) throw new AccountLocaleStaleError()
    if (ticket.token !== this.deps.getToken()) {
      if (retryOnRotation) return this.readCurrent(false)
      throw new AccountLocaleStaleError()
    }
    return this.merge(user, ticket, false)
  }
  async restore(user: UserInfo, ticket: ReturnType<UserLocaleTasks['capture']>) {
    if (!this.valid(ticket) || ticket.readId !== this.readId || ticket.token !== this.deps.getToken()) throw new AccountLocaleStaleError()
    return this.merge(user, ticket, true)
  }
  private async merge(user: UserInfo, ticket: ReturnType<UserLocaleTasks['capture']>, local: boolean) {
    // Local UUID and API hash IDs differ; email can bind the same user as the token.
    const token = this.deps.getToken()!
    let claims: Record<string, unknown> = {}
    try {
      const p = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
      claims = JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4)))
    } catch {}
    const id = claims.id ?? claims.user_id ?? claims.uid ?? claims.sub
    if (String(user.userId) !== String(id) && (!user.email || user.email !== claims.email)) throw new AccountLocaleStaleError()
    const confirmed = this.store.confirmedAccountLocale
    const incoming = locale(user.lang)
    const keep = confirmed && (local || ticket.revision !== this.revision)
    const next = keep ? confirmed.locale : (incoming ?? confirmed?.locale ?? locale(this.store.locale) ?? 'en')
    this.store.user = { ...user, lang: next }
    if (!local && incoming && !keep) this.store.confirmedAccountLocale = { accountKey: ticket.account!, locale: next }
    if (this.store.locale !== next) await this.local(next)
    return this.store.user!
  }
  async refreshToken(): Promise<void> {
    const ticket = this.capture(),
      token = this.deps.getToken(),
      id = ++this.refreshId,
      revision = this.revision
    if (!token) return
    if (!ticket.account) {
      if (this.deps.getToken() === token) await this.deps.expire()
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let expired = false
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true
          controller.abort()
          reject(new Error('Token refresh timeout'))
        }, 5000)
      })
      const next = await Promise.race([this.deps.api.refreshToken(token, controller.signal), timeout])
      if (localeAccountIdentity(next) !== ticket.account) throw new Error('Invalid refreshed account identity')
      if (!expired && id === this.refreshId && this.valid(ticket) && revision === this.revision && this.deps.getToken() === token) this.deps.setToken(next)
    } catch (error) {
      if (error instanceof AccountLocaleUnauthorizedError && this.deps.getToken() === token) await this.deps.expire()
      else console.warn('[locale] token refresh failed', error)
    } finally {
      clearTimeout(timer)
    }
  }
}
const instances = new WeakMap<object, UserLocaleTasks>()
export const getUserLocaleTasks = (store: LocaleUserState, deps?: Deps): UserLocaleTasks => {
  let tasks = instances.get(store)
  if (!tasks) {
    if (!deps) throw new Error('Locale tasks not initialized')
    tasks = new UserLocaleTasks(store, deps)
    instances.set(store, tasks)
  }
  return tasks
}
export const existingUserLocaleTasks = (store: object) => instances.get(store)
