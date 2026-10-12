import { inject, singleton } from '../../decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '../../const/symbol'
import type { LazyInstance } from '../../decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'

export interface ApiKeyPO {
  id: number
  uuid: string
  userId: number
  keyPrefix: string
  keyHash: string
  name: string
  createdAt: Date
  updatedAt: Date
}

@singleton()
export class ApiKeyRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>) {}

  async upsertApiKey(data: { userId: number; keyPrefix: string; keyHash: string; name: string }): Promise<ApiKeyPO> {
    const res = await this.prismaPg().$transaction(async tx => {
      const users = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM sr_user WHERE id = ${data.userId} AND deleted_at IS NULL FOR UPDATE`
      if (users.length !== 1) throw new Error('Cannot issue credentials for an inactive user')
      return tx.sr_user_api_key.upsert({
        where: { user_id: data.userId },
        create: {
          user_id: data.userId,
          key_prefix: data.keyPrefix,
          key_hash: data.keyHash,
          name: data.name
        },
        update: {
          key_prefix: data.keyPrefix,
          key_hash: data.keyHash,
          name: data.name,
          updated_at: new Date()
        }
      })
    })
    return {
      id: res.id,
      uuid: res.uuid,
      userId: res.user_id,
      keyPrefix: res.key_prefix,
      keyHash: res.key_hash,
      name: res.name,
      createdAt: res.created_at,
      updatedAt: res.updated_at
    }
  }

  async findByUserId(userId: number): Promise<ApiKeyPO | null> {
    const res = await this.prismaPg().sr_user_api_key.findFirst({
      where: { user_id: userId }
    })
    if (!res) return null
    return {
      id: res.id,
      uuid: res.uuid,
      userId: res.user_id,
      keyPrefix: res.key_prefix,
      keyHash: res.key_hash,
      name: res.name,
      createdAt: res.created_at,
      updatedAt: res.updated_at
    }
  }
}
