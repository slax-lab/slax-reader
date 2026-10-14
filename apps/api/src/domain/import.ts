import { randomUUID } from 'crypto'
import { ServerError, TooManyImportTasksError, ErrorParam } from '@/const/err'
import { ContextManager } from '@/utils/context'
import { inject, injectable } from '@/decorators/di'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import type { LazyInstance } from '@/decorators/lazy'
import { KVClient } from '@/infra/repository/KVClient'
import { QueueClient, importBookmarkMessage } from '@/infra/queue/queueClient'
import { BucketClient } from '@/infra/repository/bucketClient'
import { BookmarkService } from '@/domain/bookmark'
import { parseCSV, parseCSVLine } from '@/utils/csv'
import { RedisClient } from '@/infra/repository/redisClient'
import { Hashid } from '@/utils/hashids'
import { importPreview, isNewImportSource, parseImport, type ImportRecord } from '@/utils/importFormats'
import { getEventContext } from '@/domain/events'

export interface importProcessResponse {
  id: number
  batch_count: number
  current_count: number
  count: number
  status: number
  type: string
  reason: string
  created_at: string
}

export interface omnivoreData {
  id: string
  slug: string
  title: string
  description: string
  author: string
  url: string
  state: string
  readingProgress: number
  thumbnail: string
  labels: string[]
  savedAt: string
  updatedAt: string
  publishedAt: string
}

export interface pocketData {
  title: string
  url: string
  time_added: string
  tags: string
  status: string
}

// An import still "processing" after this long is marked failed so it cannot block the user's next import.
export const IMPORT_TASK_TIMEOUT_MS = 2 * 60 * 60 * 1000
const IMPORT_TIMEOUT_REASON = 'Timed out: the import did not finish within 2 hours'
// How many imports one user may have processing at the same time. The web client mirrors this number.
export const MAX_ACTIVE_IMPORT_TASKS = 5

interface importProgress {
  current: number
  success: number
  failed: number
  // 'db' means Redis counters were unavailable and progress came from import relations (skipped duplicates are not counted there).
  source: 'redis' | 'db'
}

interface importTaskRow {
  id: number
  user_id: number
  batch_count: number
  created_at: Date
}

export interface importProcessResponse {
  id: number
  batch_count: number
  current_count: number
  count: number
  status: number
  type: string
  reason: string
  created_at: string
  success_total: number
  failed_total: number
}

@injectable()
export class ImportService {
  private bookmarkData: BookmarkRepo
  private bucketData: LazyInstance<BucketClient>
  private bookmarkService: BookmarkService
  private redisClient: LazyInstance<RedisClient>

  constructor(
    @inject(BookmarkRepo) bookmarkRepo: BookmarkRepo,
    @inject(QueueClient) queueClient: LazyInstance<QueueClient>,
    @inject(KVClient) kvClient: LazyInstance<KVClient>,
    @inject(BucketClient) bucketClient: LazyInstance<BucketClient>,
    @inject(BookmarkService) bookmarkService: BookmarkService,
    @inject(RedisClient) redisClient: LazyInstance<RedisClient>
  ) {
    this.bookmarkData = bookmarkRepo
    this.bucketData = bucketClient
    this.bookmarkService = bookmarkService
    this.redisClient = redisClient
  }

  /**
   * Up to MAX_ACTIVE_IMPORT_TASKS imports may run at once. Tasks that already finished their
   * work or timed out are closed here first so they never count against the limit.
   * A task whose check fails is assumed to still be running. The limit is soft: two requests
   * arriving together can both pass the count.
   */
  async ensureImportCapacity(ctx: ContextManager) {
    const processing = await this.bookmarkData.getUserProcessingImportTasks(ctx.getUserId())
    let running = 0
    for (const item of processing) {
      try {
        if (!(await this.settleImportTask(item))) running++
      } catch (err) {
        console.error(`import task ${item.id} check failed, counting it as running: ${err}`)
        running++
      }
    }
    if (running >= MAX_ACTIVE_IMPORT_TASKS) throw TooManyImportTasksError()
  }

  /** Closes a processing task when it is complete or timed out. Returns true when the task is no longer running. */
  private async settleImportTask(item: importTaskRow): Promise<boolean> {
    const progress = await this.readImportProgress(item.user_id, item.id)
    if (progress.current >= item.batch_count) {
      await this.finishImportTask(item, progress)
      return true
    }
    if (item.created_at.getTime() < Date.now() - IMPORT_TASK_TIMEOUT_MS) {
      console.log(`import task ${item.id} timed out, progress ${progress.current}/${item.batch_count} (${progress.source})`)
      await this.bookmarkData.updateImportTaskCounters(item.id, progress.success, progress.failed).catch(e => console.error(`import counters sync failed: ${e}`))
      await this.bookmarkData.updateBookmarkImportTask(item.id, 2, IMPORT_TIMEOUT_REASON)
      return true
    }
    return false
  }

  private async finishImportTask(item: importTaskRow, progress: importProgress) {
    await this.bookmarkData.updateImportTaskCounters(item.id, progress.success, progress.failed)
    await Promise.allSettled([
      Promise.resolve().then(() => this.redisClient().userImportProcess(item.user_id, item.id).del()),
      Promise.resolve().then(() => this.redisClient().userImportSuccess(item.user_id, item.id).del()),
      Promise.resolve().then(() => this.redisClient().userImportFailed(item.user_id, item.id).del())
    ])
    await this.bookmarkData.updateBookmarkImportTask(item.id, 3, '')
    console.log(`import task ${item.id} finished - success: ${progress.success}, failed: ${progress.failed}`)
  }

  /** Redis holds the live counters; when it is unavailable, count import relations so status never errors. */
  private async readImportProgress(userId: number, id: number): Promise<importProgress> {
    const read = (key: { getString(): Promise<string> }) =>
      key.getString().then(value => {
        if (value === '' || value == null || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error('Missing or invalid import counter')
        return Number(value)
      })
    const [current, success, failed] = await Promise.allSettled([
      Promise.resolve().then(() => read(this.redisClient().userImportProcess(userId, id))),
      Promise.resolve().then(() => read(this.redisClient().userImportSuccess(userId, id))),
      Promise.resolve().then(() => read(this.redisClient().userImportFailed(userId, id)))
    ])
    if (current.status === 'fulfilled') {
      return {
        current: current.value,
        success: success.status === 'fulfilled' ? success.value : 0,
        failed: failed.status === 'fulfilled' ? failed.value : 0,
        source: 'redis'
      }
    }
    console.error(`import progress redis read failed for task ${id}: ${current.reason}`)
    const counts = await this.bookmarkData.countImportRelationStatus(id)
    const successCount = counts[1] ?? 0
    const failedCount = counts[2] ?? 0
    return { current: successCount + failedCount, success: successCount, failed: failedCount, source: 'db' }
  }

  previewImport(type: string, blob: string, includeFeed = false) {
    if (!isNewImportSource(type)) throw ErrorParam()
    return importPreview(parseImport(type, blob, includeFeed))
  }

  async importBookmark(ctx: ContextManager, type: string, fileType: string, blob: string, includeFeed = false): Promise<number> {
    const data = isNewImportSource(type) ? parseImport(type, blob, includeFeed).records : this.parseAndSortData(type as 'pocket' | 'omnivore', blob)
    if (!Array.isArray(data) || data.length === 0 || data.length > 10000) {
      console.error(`importBookmark invalid record count`)
      throw ErrorParam()
    }

    const name = `import/data/${ctx.getUserId()}/${type}/${randomUUID()}`
    await this.bucketData().R2Bucket.put(name, blob, { httpMetadata: { contentType: fileType } })
    const res = await this.bookmarkData.createBookmarkImportTask(ctx.getUserId(), type, name, data.length, data.length)
    if (!res) throw ServerError()

    ctx.execution.waitUntil(
      this.sendQueueMessages(ctx, type, res.id, data).catch(async () => {
        await this.bookmarkData.updateBookmarkImportTask(res.id, 2, 'Queue dispatch failed')
      })
    )

    console.log(`Import accepted: task ${res.id}, ${data.length} records`)
    return res.id
  }

  private parseAndSortData(type: 'pocket' | 'omnivore', blob: string): (omnivoreData | pocketData)[] {
    let data: (omnivoreData | pocketData)[] = []
    if (type === 'pocket') {
      data = parseCSV<pocketData>(blob)
    } else if (type === 'omnivore') {
      data = JSON.parse(blob) as omnivoreData[]
    }
    if (!Array.isArray(data) || data.length > 10000) throw ErrorParam()

    const sortData = (data: (omnivoreData | pocketData)[]) => {
      if (type === 'pocket') {
        return data.sort((a, b) => {
          const pocketA = a as pocketData
          const pocketB = b as pocketData

          const isArchiveA = pocketA.status === 'archive'
          const isArchiveB = pocketB.status === 'archive'
          if (isArchiveA !== isArchiveB) {
            return isArchiveA ? 1 : -1
          }

          const timeA = new Date(pocketA.time_added || '1970-01-01').getTime()
          const timeB = new Date(pocketB.time_added || '1970-01-01').getTime()
          return timeB - timeA
        })
      } else if (type === 'omnivore') {
        return data.sort((a, b) => {
          const omnivoreA = a as omnivoreData
          const omnivoreB = b as omnivoreData

          const timeA = new Date(omnivoreA.savedAt || '1970-01-01').getTime()
          const timeB = new Date(omnivoreB.savedAt || '1970-01-01').getTime()
          return timeB - timeA
        })
      }
    }

    return data.length <= 200 ? data : sortData(data)!
  }

  private async sendQueueMessages(ctx: ContextManager, type: string, taskId: number, data: (omnivoreData | pocketData | ImportRecord)[]) {
    const batchSize = 1
    const queueBatchSize = 100
    const maxNormalImport = 200

    const queueMessages: importBookmarkMessage[] = []
    for (let i = 0; i < data.length; i += batchSize) {
      queueMessages.push({
        eventContext: { ...getEventContext(ctx), source: 'import' },
        type,
        id: taskId,
        userId: ctx.getUserId(),
        data: data.slice(i, i + batchSize),
        idx: i,
        version: isNewImportSource(type) ? 1 : undefined
      })
    }

    const normalMessages = queueMessages.slice(0, Math.ceil(maxNormalImport / batchSize))
    const slowMessages = queueMessages.slice(Math.ceil(maxNormalImport / batchSize))

    if (normalMessages.length > 0) {
      for (let i = 0; i < normalMessages.length; i += queueBatchSize) {
        const batch = normalMessages.slice(i, i + queueBatchSize)
        await ctx.env.IMPORT_OTHER.sendBatch(batch.map(msg => ({ body: msg })))
      }
    }

    if (slowMessages.length > 0) {
      for (let i = 0; i < slowMessages.length; i += queueBatchSize) {
        const batch = slowMessages.slice(i, i + queueBatchSize)
        await ctx.env.IMPORT_OTHER_SLOW.sendBatch(batch.map(msg => ({ body: msg })))
      }
    }

    console.log(`队列消息发送完成 - 普通队列: ${normalMessages.length}, 慢队列: ${slowMessages.length}`)
  }

  public async getImportInfo(ctx: ContextManager): Promise<importProcessResponse[]> {
    const res = await this.bookmarkData.getUserImportTask(ctx.getUserId())
    if (!res) throw ErrorParam()

    // Live counters are read for every processing task at once; finished tasks use their stored totals.
    return await Promise.all(
      res.map(async (item): Promise<importProcessResponse> => {
        const itemData: importProcessResponse = {
          ...item,
          id: ctx.hashIds.encodeId(item.id),
          created_at: item.created_at.toISOString(),
          current_count: item.batch_count,
          count: item.total_count
        }

        //0- 未开始 1- 进行中 2- 失败 3- 完成
        if (item.status === 1) {
          const progress = await this.readImportProgress(ctx.getUserId(), item.id)
          itemData.current_count = progress.current
          itemData.success_total = progress.success
          itemData.failed_total = progress.failed
        }
        return itemData
      })
    )
  }

  async getImportProcess(env: Env, userId: number, id: number) {
    const res = await this.redisClient().userImportProcess(userId, id).getString()
    if (res) return Number(res)

    return 0
  }

  async getImportSuccess(userId: number, id: number) {
    const res = await this.redisClient().userImportSuccess(userId, id).getString()
    if (res) return Number(res)

    return 0
  }

  async getImportFailed(userId: number, id: number) {
    const res = await this.redisClient().userImportFailed(userId, id).getString()
    if (res) return Number(res)

    return 0
  }

  public async checkImportTaskProcess(ctx: ContextManager) {
    const res = await this.bookmarkData.getUnfinishedImportTask()
    res.length > 0 && console.log(`has ${res.length} unfinished import task`)

    // One task's failure must not stop the others from being checked.
    for (const item of res) {
      try {
        const settled = await this.settleImportTask(item)
        if (!settled) console.log(`cronjob checkImportTaskProcess item: ${item.id} still processing`)
      } catch (err) {
        console.error(`cronjob checkImportTaskProcess item ${item.id} failed: ${err}`)
      }
    }
  }

  public async processImportBookmark(ctx: ContextManager, message: { id: number; info: importBookmarkMessage }) {
    const onFaild = async (err: string) => {
      console.error(`import bookmark failed: ${JSON.stringify(err)}`)
      await this.bookmarkData.appendImportTaskErrLog(message.id, err)
    }

    const hashids = new Hashid(ctx.env, message.info.userId)
    const enUserId = hashids.encodeId(message.info.userId)
    ctx.setUserInfo(message.info.userId, enUserId, '', '')
    ctx.setHashIds(hashids)

    if (isNewImportSource(message.info.type)) {
      if (message.info.version !== 1) throw ErrorParam()
      return (message.info.data as ImportRecord[]).map(item => ({ ...item, thumbnail: '', description: '' }))
    } else if (message.info.type === 'omnivore') {
      return message.info.data.map(item => ({
        target_url: item.url,
        thumbnail: item.thumbnail,
        description: item.description,
        tags: item.labels,
        target_title: item.title,
        is_archive: false
      }))
    } else if (message.info.type === 'pocket') {
      return message.info.data.map(item => ({
        target_url: !!item.url && item.url && item.url.length > 0 ? item.url : '',
        thumbnail: '',
        description: '',
        tags: !!item.tags && item.tags && item.tags.length > 0 ? item.tags.split('|') : [],
        target_title: !!item.title && item.title && item.title.length > 0 ? item.title : '',
        is_archive: !!item && item.status === 'archive' ? true : false
      }))
    } else if (message.info.type === 'fetch_retry') {
      return message.info.data.map(item => ({
        target_url: item.target_url,
        thumbnail: '',
        description: '',
        tags: item.tags,
        target_title: '',
        is_archive: false,
        callback: message.info.callback,
        callbackPayload: message.info.callbackPayload
      }))
    } else {
      await onFaild(`import bookmark type not match: ${message.info.type}`)
      return []
    }
  }

  public async incrImportTask(ctx: ContextManager, userId: number, id: number, successCount = 0, failedCount = 0) {
    const promises = [
      this.redisClient()
        .userImportProcess(userId, id)
        .incrBy(Math.max(1, successCount + failedCount))
    ]

    if (successCount > 0) promises.push(this.redisClient().userImportSuccess(userId, id).incrBy(successCount))

    if (failedCount > 0) promises.push(this.redisClient().userImportFailed(userId, id).incrBy(failedCount))

    const [processResult] = await Promise.allSettled(promises)

    if (processResult.status === 'fulfilled') {
      return processResult.value
    }

    return 0
  }
}
