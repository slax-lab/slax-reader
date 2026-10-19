import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import type { PrismaClient } from '@prisma/hyperdrive-client'
import type { DesktopCodeAccount, DesktopCodeBinding, DesktopCodeStore } from '@/domain/desktopAuthPolicy'

export const ISSUE_DESKTOP_CODE_SQL = `INSERT INTO sr_desktop_auth_code (code_hash, user_id, challenge, state_hash, deployment)
SELECT $1, id, $3, $4, $5 FROM sr_user WHERE id = $2 AND deleted_at IS NULL
RETURNING expires_at`
export const CONSUME_DESKTOP_CODE_SQL = `WITH attempt AS (
DELETE FROM sr_desktop_auth_code WHERE code_hash = $1 AND deployment = $4
RETURNING user_id, challenge, state_hash, expires_at, consumed_at
)
SELECT account.id, account.uuid, account.email, account.name, account.picture, account.lang
FROM attempt AS code JOIN sr_user AS account ON account.id = code.user_id
WHERE code.challenge = $2 AND code.state_hash = $3 AND code.consumed_at IS NULL
AND code.expires_at > CURRENT_TIMESTAMP AND account.deleted_at IS NULL`
export const CLEANUP_DESKTOP_CODE_SQL = `DELETE FROM sr_desktop_auth_code WHERE code_hash IN
(SELECT code_hash FROM sr_desktop_auth_code WHERE consumed_at IS NOT NULL OR expires_at <= CURRENT_TIMESTAMP ORDER BY expires_at LIMIT 500)`

@injectable()
export class DesktopAuthRepo implements DesktopCodeStore {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prisma: LazyInstance<PrismaClient>) {}
  async issue(binding: DesktopCodeBinding, userId: number): Promise<Date | null> {
    const rows = await this.prisma().$queryRawUnsafe<Array<{ expires_at: Date }>>(
      ISSUE_DESKTOP_CODE_SQL,
      binding.codeHash,
      userId,
      binding.challenge,
      binding.stateHash,
      binding.deployment
    )
    return rows[0]?.expires_at ?? null
  }
  async consume(binding: DesktopCodeBinding): Promise<DesktopCodeAccount | null> {
    const rows = await this.prisma().$queryRawUnsafe<DesktopCodeAccount[]>(CONSUME_DESKTOP_CODE_SQL, binding.codeHash, binding.challenge, binding.stateHash, binding.deployment)
    return rows[0] ?? null
  }
  async cleanup(): Promise<void> {
    await this.prisma().$executeRawUnsafe(CLEANUP_DESKTOP_CODE_SQL)
  }
}
