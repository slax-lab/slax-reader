import type { PrismaClient } from '@prisma/hyperdrive-client'
import type { Container } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import { UnauthorizedError } from '@/const/err'

export async function requireActiveReaderUser(prisma: PrismaClient, userId: number): Promise<void> {
  if (!Number.isSafeInteger(userId) || userId < 1) throw UnauthorizedError()
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id, CURRENT_TIMESTAMP AS checked_at FROM sr_user
    WHERE id = ${userId} AND deleted_at IS NULL LIMIT 1
  `
  if (rows.length !== 1) throw UnauthorizedError()
}

export async function requireActiveUser(container: Container, userId: number): Promise<void> {
  if (!Number.isSafeInteger(userId) || userId < 1) throw UnauthorizedError()
  await requireActiveReaderUser(container.resolve<PrismaClient>(PRISIMA_HYPERDRIVE_CLIENT), userId)
}
