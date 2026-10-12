import { Redis } from '@upstash/redis/cloudflare'
import { singleton } from '../../decorators/di'
import { inject } from '@/decorators/di'

class RedisOperation<T> {
  constructor(
    private readonly client: Redis,
    private readonly key: string
  ) {}

  async get(): Promise<T | null> {
    const value = await this.client.get(this.key)
    if (!value) return null

    try {
      return typeof value === 'string' ? (JSON.parse(value) as T) : (value as unknown as T)
    } catch {
      return value as unknown as T
    }
  }

  async consume(): Promise<T | null> {
    const value = await this.client.eval<[], string | T | null>(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]) end; return value",
      [this.key],
      []
    )
    return typeof value === 'string' ? (JSON.parse(value) as T) : value
  }

  async del(): Promise<void> {
    await this.client.del(this.key)
  }

  async getString(): Promise<string> {
    const value = await this.client.get(this.key)
    if (!value) return ''
    return value as string
  }

  async set(value: T): Promise<void> {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
    await this.client.set(this.key, stringValue)
  }

  async setWithExpire(value: T, seconds: number): Promise<void> {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
    await this.client.set(this.key, stringValue, { ex: seconds })
  }

  async incr(): Promise<number> {
    return this.client.incr(this.key)
  }

  async incrBy(value: number): Promise<number> {
    return this.client.incrby(this.key, value)
  }

  async incrWithExpire(seconds: number): Promise<number> {
    const value = await this.incr()
    await this.expire(seconds)
    return value
  }

  async incrWithExpireAt(seconds: number): Promise<number> {
    const value = await this.incr()
    await this.expireat(seconds)
    return value
  }

  async delete(): Promise<void> {
    await this.client.del(this.key)
  }

  async exists(): Promise<number> {
    return this.client.exists(this.key)
  }

  async expireat(seconds: number): Promise<void> {
    await this.client.expireat(this.key, seconds)
  }

  async expire(seconds: number): Promise<void> {
    await this.client.expire(this.key, seconds)
  }
}

@singleton()
export class RedisClient {
  private client: Redis

  constructor(env: Env) {
    this.client = Redis.fromEnv(env)
  }

  key<T>(key: string): RedisOperation<T> {
    return new RedisOperation<T>(this.client, key)
  }

  userProfile(userId: string) {
    return this.key<Record<string, any>>(`user_profile:${userId}`)
  }

  userImportProcess(userId: number, id: number) {
    return this.key<Record<string, any>>(`user_import_process:${userId}:${id}`)
  }

  userImportSuccess(userId: number, id: number) {
    return this.key<number>(`user_import_success:${userId}:${id}`)
  }

  userImportFailed(userId: number, id: number) {
    return this.key<number>(`user_import_failed:${userId}:${id}`)
  }

  twitterOAuthState(state: string) {
    return this.key<{
      userId: number
      codeVerifier: string
      createdAt: number
    }>(`twitter_oauth_state:${state}`)
  }
}
