import { ServerError } from '@/const/err'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { RedisClient } from './redisClient'

export interface EmailChallengeKey {
  environment: string
  purpose: 'login' | 'bind'
  addressHash: string
}

export interface EmailChallenge {
  requestId: string
  recipient: string
  digest: string
  userId?: number
}

@injectable()
export class EmailChallengeRepo {
  constructor(@inject(RedisClient) private redis: LazyInstance<RedisClient>) {}

  private async access<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch {
      // Redis transport errors may contain the command arguments.
      throw ServerError()
    }
  }

  private emailKey<T>(environment: string, suffix: string) {
    return this.redis().key<T>(`{email-otp:${environment}}:${suffix}`)
  }

  private challenge({ environment, purpose, addressHash }: EmailChallengeKey) {
    return this.emailKey<EmailChallenge>(environment, `challenge:${purpose}:${addressHash}`)
  }

  takeEmailCooldown({ environment, purpose, addressHash }: EmailChallengeKey, seconds: number): Promise<boolean> {
    return this.access(() => this.emailKey<number>(environment, `cooldown:${purpose}:${addressHash}`).setIfAbsent(1, seconds))
  }

  countEmailSend(environment: string, dimension: 'address' | 'ip' | 'device' | 'environment', key: string, seconds: number): Promise<number> {
    return this.access(() => this.emailKey<number>(environment, `quota:${dimension}:${key}`).incrementWithInitialExpiry(seconds))
  }

  countEmailAttempt(environment: string, requestId: string, seconds: number): Promise<number> {
    return this.access(() => this.emailKey<number>(environment, `attempt:${requestId}`).incrementWithInitialExpiry(seconds))
  }

  saveEmail(key: EmailChallengeKey, challenge: EmailChallenge, seconds: number): Promise<void> {
    return this.access(() => this.challenge(key).setWithExpire(challenge, seconds))
  }

  readEmail(key: EmailChallengeKey): Promise<EmailChallenge | null> {
    return this.access(() => this.challenge(key).get())
  }

  removeEmail(key: EmailChallengeKey, challenge: EmailChallenge): Promise<boolean> {
    return this.access(() => this.challenge(key).deleteIfUnchanged(challenge))
  }
}
