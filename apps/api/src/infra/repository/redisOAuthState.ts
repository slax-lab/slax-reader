import { ServerError } from '@/const/err'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import type { EmailAuthClientPlatform, EmailAuthProvider } from '@slax-reader/contracts/email-auth'
import { RedisClient } from './redisClient'

interface ProviderChallenge {
  type: EmailAuthProvider
  platform: EmailAuthClientPlatform
  nonce: string
}

interface TwitterChallenge {
  userId: number
  codeVerifier: string
  createdAt: number
}

@injectable()
export class OAuthStateRepo {
  constructor(@inject(RedisClient) private redis: LazyInstance<RedisClient>) {}

  private async access<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch {
      throw ServerError()
    }
  }

  private providerKey(environment: string, userId: number, state: string) {
    return this.redis().key<ProviderChallenge>(`auth:provider:${environment}:${userId}:${state}`)
  }

  private twitterKey(state: string) {
    return this.redis().key<TwitterChallenge>(`twitter_oauth_state:${state}`)
  }

  saveProvider(environment: string, userId: number, state: string, challenge: ProviderChallenge, seconds: number): Promise<void> {
    return this.access(() => this.providerKey(environment, userId, state).setWithExpire(challenge, seconds))
  }

  consumeProvider(environment: string, userId: number, state: string): Promise<ProviderChallenge | null> {
    return this.access(() => this.providerKey(environment, userId, state).consume())
  }

  saveTwitter(state: string, challenge: TwitterChallenge, seconds: number): Promise<void> {
    return this.access(() => this.twitterKey(state).setWithExpire(challenge, seconds))
  }

  consumeTwitter(state: string): Promise<TwitterChallenge | null> {
    return this.access(() => this.twitterKey(state).consume())
  }

  deleteTwitter(state: string): Promise<void> {
    return this.access(() => this.twitterKey(state).delete())
  }
}
