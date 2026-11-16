import { Hashid } from './hashids'
import { setGlobalLanguage } from './multiLangError'

export interface Context {
  env: Env
  ctx: ContextManager
}

export class ContextManager {
  private userId?: number
  private encodeUserId?: number
  private email?: string
  private lang?: string
  public hashIds!: Hashid
  private context: Record<string, any> = {}
  private platform: 'web' | 'ios' | 'android' | 'extension' | '' = ''
  private cleanupCallbacks: Array<() => Promise<void>> = []

  constructor(
    public execution: ExecutionContext,
    public env: Env
  ) {}

  set(key: string, value: any) {
    this.context[key] = value
  }

  get(key: string) {
    return this.context[key]
  }

  getAll() {
    return this.context
  }

  setPlatform(platform: 'web' | 'ios' | 'android' | 'extension') {
    this.platform = platform
  }

  getPlatform() {
    return this.platform
  }

  setHashIds(hashIds: Hashid) {
    this.hashIds = hashIds
  }

  setUserInfo(deUserId: number, enUserId: number, email: string, lang: string) {
    this.userId = deUserId
    this.encodeUserId = enUserId
    this.email = email
    this.lang = lang
    setGlobalLanguage(lang)
  }

  getUserId(): number {
    return this.userId || 0
  }

  getEncodeUserId(): number {
    return this.encodeUserId || 0
  }

  getUserEmail(): string {
    return this.email || ''
  }

  getlang(): string {
    return (this.lang || '').slice(0, 2) || 'en'
  }

  onCleanup(callback: () => Promise<void>) {
    this.cleanupCallbacks.push(callback)
  }

  private streamWork?: Promise<void>
  private cleanupScheduled = false
  private cleanupWork?: Promise<void>

  deferCleanupUntil(work: Promise<unknown>) {
    if (this.cleanupScheduled || this.cleanupWork) throw new Error('cleanup_already_started')
    this.streamWork = Promise.allSettled([this.streamWork, work]).then(() => {})
  }

  private releaseResources(onError: (error: unknown) => void): Promise<void> {
    this.cleanupWork ??= Promise.all(
      this.cleanupCallbacks.map(async callback => {
        try {
          await callback()
        } catch (error) {
          onError(error)
        }
      })
    ).then(() => {
      this.cleanupCallbacks = []
    })
    return this.cleanupWork
  }

  async cleanup(onError: (error: unknown) => void = error => console.error('Cleanup error:', error)) {
    if (this.streamWork) {
      if (!this.cleanupScheduled) {
        this.cleanupScheduled = true
        this.execution.waitUntil(this.streamWork.then(() => this.releaseResources(onError)))
      }
      return
    }
    await this.releaseResources(onError)
  }
}
