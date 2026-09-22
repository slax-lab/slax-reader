import { inject, injectable, singleton } from '@/decorators/di'
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
    return this.prismaPg().sr_user_lab_feature.upsert({
      where: { user_id_feature: { user_id: userId, feature } },
      create: { user_id: userId, feature, enabled },
      update: { enabled }
    })
  }
}
