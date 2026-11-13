import type { PrismaClient } from '@prisma/hyperdrive-client'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'

export interface PasskeyAccount {
  id: number
  uuid: string
  email: string
  lang: string
  deleted_at: Date | null
}

export interface PasskeyCredential {
  id: number
  uuid: string
  user_id: number
  rp_id: string
  credential_id: string
  public_key: Uint8Array
  counter: bigint
  transports: string[]
  name: string
  created_at: Date
  last_used_at: Date | null
}

export type PasskeyCredentialCreate = Pick<PasskeyCredential, 'user_id' | 'rp_id' | 'credential_id' | 'public_key' | 'counter' | 'transports' | 'name'>

export interface PasskeyLoginMetadata {
  last_login_at: Date
  last_login_ip?: string
  country?: string
  city?: string
  region?: string
  timezone?: string
  latitude?: number
  longitude?: number
}

export interface PasskeyTransaction {
  account: PasskeyAccount | null
  findMailbox(): Promise<{ platform_id: string; user_name: string } | null>
  listCredentials(rpId: string): Promise<PasskeyCredential[]>
  findCredential(credentialId: string, rpId: string): Promise<PasskeyCredential | null>
  createCredential(input: PasskeyCredentialCreate): Promise<PasskeyCredential | null>
  updateCredential(id: number, counter: bigint): Promise<void>
  deleteCredential(uuid: string, rpId: string): Promise<number>
  countCredentials(): Promise<number>
  saveSummary(userUuid: string): Promise<void>
  deleteSummary(): Promise<void>
  recordLogin(profile: PasskeyLoginMetadata): Promise<void>
}

@injectable()
export class PasskeyRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<PrismaClient>) {}

  async findLoginAccounts(emailKey: string): Promise<PasskeyAccount[]> {
    return this.prismaPg().$queryRaw<PasskeyAccount[]>`
      SELECT u.id, u.uuid, u.email, u.lang, u.deleted_at
      FROM sr_platform_bind b JOIN sr_user u ON u.id = b.user_id
      WHERE b.platform = 'mail' AND b.platform_id = ${emailKey}
      LIMIT 2
    `
  }

  withAccount<T>(userId: number, run: (tx: PasskeyTransaction) => Promise<T>): Promise<T> {
    return this.prismaPg().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`account:${userId}`}, 0))`
      const account = await tx.sr_user.findUnique({ where: { id: userId }, select: { id: true, uuid: true, email: true, lang: true, deleted_at: true } })
      return run({
        account,
        findMailbox: () => tx.sr_platform_bind.findUnique({ where: { user_id_platform: { user_id: userId, platform: 'mail' } }, select: { platform_id: true, user_name: true } }),
        listCredentials: rpId => tx.sr_user_passkey.findMany({ where: { user_id: userId, rp_id: rpId }, orderBy: { created_at: 'asc' } }),
        findCredential: (credential_id, rp_id) => tx.sr_user_passkey.findFirst({ where: { user_id: userId, credential_id, rp_id } }),
        createCredential: async input => {
          try {
            return await tx.sr_user_passkey.create({ data: { ...input, user_id: userId } })
          } catch (error) {
            if ((error as { code?: string }).code !== 'P2002') throw error
            return null
          }
        },
        updateCredential: async (id, counter) => {
          await tx.sr_user_passkey.updateMany({ where: { id, user_id: userId }, data: { counter, last_used_at: new Date() } })
        },
        deleteCredential: async (uuid, rp_id) => (await tx.sr_user_passkey.deleteMany({ where: { uuid, rp_id, user_id: userId } })).count,
        countCredentials: () => tx.sr_user_passkey.count({ where: { user_id: userId } }),
        saveSummary: async userUuid => {
          await tx.sr_platform_bind.upsert({
            where: { user_id_platform: { user_id: userId, platform: 'passkey' } },
            create: { user_id: userId, platform: 'passkey', platform_id: userUuid, user_name: 'Passkey' },
            update: { platform_id: userUuid, user_name: 'Passkey' }
          })
        },
        recordLogin: async ({ last_login_ip, last_login_at, country, city, region, timezone, latitude, longitude }) => {
          await tx.sr_user.update({ where: { id: userId }, data: { last_login_ip, last_login_at, country, city, region, timezone, latitude, longitude } })
        },
        deleteSummary: async () => {
          await tx.sr_platform_bind.deleteMany({ where: { user_id: userId, platform: 'passkey' } })
        }
      })
    })
  }

  async deleteByUserId(userId: number): Promise<void> {
    await this.prismaPg().sr_user_passkey.deleteMany({ where: { user_id: userId } })
  }
}
