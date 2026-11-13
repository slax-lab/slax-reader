import { ServerError } from '@/const/err'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { RedisClient } from './redisClient'

export type PasskeyChallenge = {
  emailKey: string
  rpId: string
  challenge: string
} & ({ purpose: 'register'; userId: number } | { purpose: 'login' })

@injectable()
export class PasskeyChallengeRepo {
  constructor(@inject(RedisClient) private redis: LazyInstance<RedisClient>) {}

  private key(environment: string, requestId: string) {
    return this.redis().key<PasskeyChallenge>(`auth:passkey:${environment}:${requestId}`)
  }

  async save(environment: string, requestId: string, challenge: PasskeyChallenge, seconds: number): Promise<void> {
    try {
      await this.key(environment, requestId).setWithExpire(challenge, seconds)
    } catch {
      throw ServerError()
    }
  }

  async consume(environment: string, requestId: string): Promise<PasskeyChallenge | null> {
    try {
      return await this.key(environment, requestId).consume()
    } catch {
      throw ServerError()
    }
  }
}
