import { inject, injectable } from '@/decorators/di'
import { Scheduled } from '@/decorators/scheduled'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import type { PrismaClient } from '@prisma/hyperdrive-client'
import { UserDeletionService } from '@/domain/userDeletion'
import { ContextManager } from '@/utils/context'

@injectable()
export class UserDeletionJob {
  constructor(
    @inject(PRISIMA_HYPERDRIVE_CLIENT) private prisma: LazyInstance<PrismaClient>,
    @inject(UserDeletionService) private deletion: UserDeletionService
  ) {}

  @Scheduled('*/5 * * * *')
  async recoverDeletedUsers(ctx: ContextManager) {
    const cursorKey = 'user-deletion-recovery:cursor'
    const saved = Number(await ctx.env.KV.get(cursorKey))
    const cursor = Number.isSafeInteger(saved) && saved > 0 ? saved : 0
    const users = await this.prisma().sr_user.findMany({
      where: { deleted_at: { not: null }, id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: 25,
      select: { id: true, deleted_at: true }
    })
    for (const user of users) {
      try {
        const marker = `user-deletion-recovery:done:${user.id}:${user.deleted_at!.getTime()}`
        if (await ctx.env.KV.get(marker)) continue
        const server = ctx.env.WEBSOCKET_SERVER.get(ctx.env.WEBSOCKET_SERVER.idFromName('global'))
        await server.revokeUser(user.id)
        await this.deletion.cleanupUserData(user.id)
        await ctx.env.KV.put(marker, '1', { expirationTtl: 31 * 24 * 60 * 60 })
      } catch {
        console.error('User deletion recovery failed', { userId: user.id })
      }
    }
    await ctx.env.KV.put(cursorKey, users.length === 25 ? String(users[users.length - 1].id) : '0')
  }
}
