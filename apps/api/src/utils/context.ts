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

  async cleanup() {
    await Promise.all(this.cleanupCallbacks.map(cb => cb().catch(err => console.error('Cleanup error:', err))))
  }
}
