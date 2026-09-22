import { Prisma, PrismaClient } from '@prisma/client'
import { inject, injectable } from '@/decorators/di'
import { PRISIMA_CLIENT, PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'

export enum reportType {
  PARSE_ERROR = 'parse_error',
  LOSS_FUNCTION = 'loss_function',
  LIKE = 'like',
  BUG = 'bug',
  OTHER = 'other'
}

export interface reportPO {
  user_id: number
  content: string
  type: reportType
  version: string
  platform: string
  entry_point: string
  environment?: string
  bookmark_id?: number
  target_url?: string
  allow_follow_up?: boolean
  ip_address?: string
}

@injectable()
export class ReportRepo {
  constructor(
    @inject(PRISIMA_CLIENT) public data: LazyInstance<PrismaClient>,
    @inject(PRISIMA_HYPERDRIVE_CLIENT) public dataPg: LazyInstance<HyperdrivePrismaClient>
  ) {}

  // @ts-ignore
  public async saveReport(po: reportPO) {
    const data = {
      user_id: po.user_id,
      content: po.content,
      type: po.type,
      created_at: new Date(),
      extra_data: {
        platform: po.platform,
        environment: po.environment,
        version: po.version,
        entry_point: po.entry_point,
        bookmark_id: po.bookmark_id,
        target_url: po.target_url,
        ip_address: po.ip_address
      }
    }

    return await this.dataPg().sr_user_report.create({ data })
  }

  // @ts-ignore
  public async getReportDetail(reportId: number) {
    return await this.dataPg().sr_user_report.findFirst({ where: { id: reportId } })
  }
}
