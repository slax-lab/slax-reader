import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'

export interface userLabFeaturePO {
  id: number
  user_id: number
  feature: string
  enabled: boolean
  created_at: Date
  updated_at: Date
}

@injectable()
export class LabRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>) {}

  public async listByUser(userId: number): Promise<userLabFeaturePO[]> {
    return this.prismaPg().sr_user_lab_feature.findMany({ where: { user_id: userId } })
  }

  public async isEnabled(userId: number, feature: string): Promise<boolean> {
    const row = await this.prismaPg().sr_user_lab_feature.findUnique({
      where: { user_id_feature: { user_id: userId, feature } },
      select: { enabled: true }
    })
    return row?.enabled ?? false
  }

  public async upsert(userId: number, feature: string, enabled: boolean): Promise<userLabFeaturePO> {
    return this.prismaPg().$transaction(async tx => {
      // Serialize user mutations. Shared leases survive while another subscriber is active.
      await tx.$queryRaw`SELECT id FROM sr_user WHERE id = ${userId} FOR UPDATE`
      const row = await tx.sr_user_lab_feature.upsert({
        where: { user_id_feature: { user_id: userId, feature } },
        create: { user_id: userId, feature, enabled },
        update: { enabled }
      })
      if (feature === 'rss' && !enabled) {
        await tx.$queryRaw`SELECT f.id FROM sr_rss_feed f JOIN sr_rss_subscription s ON s.feed_id=f.id WHERE s.user_id=${userId} ORDER BY f.id FOR UPDATE OF f`
        await tx.$executeRaw`UPDATE sr_rss_feed f SET lease_token=NULL,lease_until=NULL WHERE EXISTS(SELECT 1 FROM sr_rss_subscription s WHERE s.feed_id=f.id AND s.user_id=${userId}) AND NOT EXISTS(SELECT 1 FROM sr_rss_subscription s JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature='rss' AND l.enabled WHERE s.feed_id=f.id)`
      }
      return row
    })
  }
}
