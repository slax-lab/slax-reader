import { Container } from '../decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '../const/symbol'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { ApiKeyNotFoundError } from '../const/err'

export interface ApiKeyVerifyResult {
  userId: number
  apiKeyId: number
}

interface ApiKeyVerifyRow {
  api_key_id: number
  user_id: number
  subscription_end_time: Date | null
}

export class ApiKeyAuth {
  private container: Container

  constructor(container: Container) {
    this.container = container
  }

  async verify(rawKey: string): Promise<ApiKeyVerifyResult> {
    const keyHash = await this.hashKey(rawKey)
    const prismaPg = this.container.resolve<HyperdrivePrismaClient>(PRISIMA_HYPERDRIVE_CLIENT)

    const rows = await prismaPg.$transaction(
      tx => tx.$queryRaw<ApiKeyVerifyRow[]>`
      SELECT ak.id AS api_key_id,
             ak.user_id,
             us.subscription_end_time,
             CURRENT_TIMESTAMP AS checked_at
      FROM sr_user_api_key ak
      INNER JOIN sr_user u ON u.id = ak.user_id AND u.deleted_at IS NULL
      LEFT JOIN sr_user_subscription us ON us.user_id = ak.user_id
      WHERE ak.key_hash = ${keyHash}
      LIMIT 1`
    )

    if (!rows || rows.length < 1) throw ApiKeyNotFoundError()

    const row = rows[0]
    // if (!row.subscription_end_time || new Date(row.subscription_end_time).getTime() < Date.now()) throw NotSubscriptionError()

    return { userId: row.user_id, apiKeyId: row.api_key_id }
  }

  private async hashKey(key: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
