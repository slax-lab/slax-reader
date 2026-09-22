import { pickTagsForBookmark } from '@/utils/tags'
import { ContextManager } from '@/utils/context'
import { inject, injectable } from '../../decorators/di'
import { AigcService } from '@/domain/aigc'
import { BookmarkService } from '@/domain/bookmark'
import { TagService } from '@/domain/tag'
import type { BookmarkTag } from '@/domain/tag'
import { BatchJobStatus } from '@/infra/external/batchCompletion'
import { AigcBatchTaskPO, AigcBatchTaskStatus } from '@/infra/repository/dbBookmark'
import { Hashid } from '@/utils/hashids'
import { MixTagsOverviewResult, OverviewObjectStreamResult } from '@/domain/aigc'

@injectable()
export class AigcBatchOrchestrator {
  constructor(
    @inject(AigcService) private aigcSvc: AigcService,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(TagService) private tagService: TagService
  ) {}

  public async processBatchTask(rawCtx: ContextManager) {
    const pendingTasks = await this.bookmarkService.getUnfinishedAigcBatchTasks('tags_overview')
    if (pendingTasks.length < 1) return

    console.log(`Found ${pendingTasks.length} pending tasks, processing...`)

    const counters = { success: 0, failed: 0, pending: 0 }
    const userTagsCache = new Map<number, BookmarkTag[]>()

    const handleFailedTask = async (task: AigcBatchTaskPO, state: BatchJobStatus, error: any) => {
      const errorMessage = state === BatchJobStatus.CANCELLED ? 'Batch cancelled' : state === BatchJobStatus.EXPIRED ? 'Batch expired' : JSON.stringify(error)
      await this.bookmarkService.updateAigcBatchTaskStatus(task.batch_request_id, AigcBatchTaskStatus.FAILED, '', errorMessage)
      console.error(`AIGC batch processing job failed: ${errorMessage}`)
    }

    for (const task of pendingTasks) {
      const result = await this.aigcSvc.getBatchTask(task.batch_request_id)

      if (!result) {
        counters.failed++
        continue
      }

      const state = result.metadata.state

      if ([BatchJobStatus.PENDING, BatchJobStatus.RUNNING].includes(state)) {
        counters.pending++
        continue
      }

      if ([BatchJobStatus.CANCELLED, BatchJobStatus.EXPIRED].includes(state)) {
        await handleFailedTask(task, state, null)
        counters.failed++
        continue
      }

      if (state === BatchJobStatus.SUCCEEDED) {
        try {
          if (!result.response?.inlinedResponses?.inlinedResponses?.[0]?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Empty AI response')
          }

          const aiText = result.response.inlinedResponses.inlinedResponses[0].response.candidates[0].content.parts[0].text

          let overview = ''
          let key_takeaways: string[] = []
          let tags: string[] = []

          try {
            const resObject = JSON.parse(aiText) as OverviewObjectStreamResult

            if (typeof resObject.overview === 'string') {
              // 兼容旧情况，后续删除
              const oldSchemaRes = resObject as unknown as MixTagsOverviewResult
              overview = oldSchemaRes.overview || ''
              key_takeaways = oldSchemaRes.key_takeaways || []
            } else {
              overview = resObject.overview?.gist || ''
              key_takeaways = resObject.overview?.key_takeaways || []
            }

            tags = resObject.tags
          } catch (e) {
            const overviewMatch = aiText.match(/<overview>(.*?)<\/overview>/s)
            overview = overviewMatch?.[1]?.trim() || ''

            const tagsMatches = aiText.matchAll(/<tags>(.*?)<\/tags>/g)
            tags = [...tagsMatches].map(match => match[1].trim())
          }

          if (overview.length > 0) {
            await this.bookmarkService.createBookmarkOverview(task.user_id, task.bookmark_id, '', JSON.stringify({ overview, key_takeaways }))
          }

          if (tags.length > 0) {
            if (!userTagsCache.has(task.user_id)) {
              const ctx = new ContextManager(rawCtx.execution, rawCtx.env)
              ctx.setUserInfo(task.user_id, task.user_id, '', '')
              ctx.setHashIds(new Hashid(ctx.env, task.user_id))
              userTagsCache.set(task.user_id, await this.tagService.listUserTags(ctx))
            }

            const vocabulary = userTagsCache.get(task.user_id) || []
            // mine first, then auto, capped at 3
            const availableTags = pickTagsForBookmark(tags, vocabulary).map(tag => tag.name)

            if (availableTags.length > 0) {
              const ctx = new ContextManager(rawCtx.execution, rawCtx.env)
              ctx.setUserInfo(task.user_id, task.user_id, '', '')
              ctx.setHashIds(new Hashid(ctx.env, task.user_id))
              const tags = await this.tagService.getBookmarkTags(ctx, task.user_id, task.bookmark_id)
              // 如果Tags不为空，则代表此前用户已经手动打过了，此时不去替换结果
              if (tags.length < 1) {
                await this.bookmarkService.tagBookmark(ctx, task.user_id, task.bookmark_id, availableTags)
              }
            }
          }

          // TODO: 目前是完整写result了，后续看到这个TODO证明功能没问题，就把aiText删掉
          await this.bookmarkService.updateAigcBatchTaskStatus(task.batch_request_id, AigcBatchTaskStatus.COMPLETED, aiText, undefined)
          counters.success++
        } catch (e) {
          await handleFailedTask(task, state, e)
          counters.failed++
        }
      }
    }

    console.log(`AIGC batch processing job completed: ${counters.success} success, ${counters.failed} failed, ${counters.pending} pending`)
  }
}
