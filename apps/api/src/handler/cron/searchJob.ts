import { ContextManager } from '@/utils/context'
import { injectable } from '../../decorators/di'
import { Scheduled } from '../../decorators/scheduled'

@injectable()
export class SearchJob {
  @Scheduled('17 3 * * *')
  public async optimizeFulltext(ctx: ContextManager) {
    try {
      await ctx.env.DB_FULLTEXT.prepare("INSERT INTO slax_fts_bookmark(slax_fts_bookmark) VALUES('optimize')").run()
      console.log('[search] fulltext optimize completed')
    } catch (e) {
      console.error(`[search] fulltext optimize failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
