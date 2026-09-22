import type { ApiKeyCreateResult as ApiKeyCreateResultContract, ApiKeyListItem as ApiKeyListItemContract } from '@slax-reader/contracts'
import { inject, singleton } from '../decorators/di'
import { ApiKeyRepo } from '../infra/repository/dbApiKey'
import { SubscriptionRepo } from '../infra/repository/dbSubscription'
import { ContextManager } from '@/utils/context'
import { NotSubscriptionError } from '../const/err'

export type ApiKeyCreateResult = ApiKeyCreateResultContract<Date>
export type ApiKeyListItem = ApiKeyListItemContract<Date>

const API_KEY_PREFIX = 'sr-'

@singleton()
export class ApiKeyService {
  constructor(
    @inject(ApiKeyRepo) private apiKeyRepo: ApiKeyRepo,
    @inject(SubscriptionRepo) private subscriptionRepo: SubscriptionRepo
  ) {}

  public async createApiKey(ctx: ContextManager, name: string): Promise<ApiKeyCreateResult> {
    const userId = ctx.getUserId()
    // await this.ensureUserSubscribed(userId)

    return this.upsertKey(userId, name || 'Default')
  }

  public async rollApiKey(ctx: ContextManager, name?: string): Promise<ApiKeyCreateResult> {
    const userId = ctx.getUserId()
    // await this.ensureUserSubscribed(userId)

    return this.upsertKey(userId, name || 'Default')
  }

  public async listApiKeys(ctx: ContextManager): Promise<ApiKeyListItem[]> {
    const key = await this.apiKeyRepo.findByUserId(ctx.getUserId())
    if (!key) return []
    return [
      {
        id: key.id,
        name: key.name,
        short_key: key.keyPrefix,
        created_at: key.createdAt
      }
    ]
  }

  private async upsertKey(userId: number, name: string): Promise<ApiKeyCreateResult> {
    const rawKey = this.generateRawKey()
    const keyHash = await this.hashKey(rawKey)

    const record = await this.apiKeyRepo.upsertApiKey({
      userId,
      keyPrefix: rawKey.substring(0, 9),
      keyHash,
      name
    })

    return {
      id: record.id,
      name: record.name,
      key: rawKey,
      created_at: record.createdAt
    }
  }

  private async ensureUserSubscribed(userId: number): Promise<void> {
    const sub = await this.subscriptionRepo.getUserSubscriptionInfoPO(userId)
    if (!sub || sub.endTime.getTime() < Date.now()) throw NotSubscriptionError()
  }

  private generateRawKey(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return `${API_KEY_PREFIX}${Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')}`
  }

  private async hashKey(key: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
