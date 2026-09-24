import { Controller } from '@/decorators/controller'
import { Get, Post } from '@/decorators/route'
import { inject } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { Failed, Successed } from '@/utils/responseUtils'
import { RequestUtils } from '@/utils/requestUtils'
import { RssService } from '@/domain/rss'
import { RssError } from '@/domain/rss/feed'
import type { RssEntriesQuery } from '@slax-reader/contracts'

async function readSubscriptionBody(request: Request): Promise<{ url?: unknown; remark?: unknown } | null> {
  const reader = request.body?.getReader()
  if (!reader) return null
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8192) {
        await reader.cancel()
        throw new RssError('invalid_feed', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

const resourceId = (request: Request) => {
  const id = new URL(request.url).pathname.split('/')[4]
  if (!id || !/^[a-f\d-]{36}$/.test(id)) throw new RssError('not_found', 404)
  return id
}
@Controller('/v1/rss')
export class RssController {
  constructor(@inject(RssService) private rss: RssService) {}
  private async respond(work: () => Promise<unknown>) {
    try {
      const response = Successed(await work())
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    } catch (error) {
      if (!(error instanceof RssError)) throw error
      const response = Failed({ error: error.code, ...(error.nextAllowedAt ? { next_allowed_at: error.nextAllowedAt.toISOString() } : {}) }, error.status, error.code)
      response.headers.set('Cache-Control', 'private, no-store')
      if (error.nextAllowedAt) response.headers.set('Retry-After', String(Math.max(1, Math.ceil((error.nextAllowedAt.valueOf() - Date.now()) / 1000))))
      return response
    }
  }
  @Get('/subscriptions')
  async listSubscriptions(ctx: ContextManager, request: Request) {
    return this.respond(() => this.rss.subscriptions(ctx))
  }
  @Post('/subscriptions')
  async addSubscription(ctx: ContextManager, request: Request) {
    return this.respond(async () => {
      const body = await readSubscriptionBody(request)
      if (typeof body?.url !== 'string') throw new RssError('invalid_feed')
      return this.rss.add(ctx, body.url, body.remark)
    })
  }
  @Post('/subscriptions/:id/update')
  async updateSubscription(ctx: ContextManager, request: Request) {
    return this.respond(async () => {
      const body = await readSubscriptionBody(request)
      if (!body || !Object.prototype.hasOwnProperty.call(body, 'remark')) throw new RssError('invalid_remark', 400)
      return this.rss.update(ctx, resourceId(request), body.remark)
    })
  }
  @Post('/subscriptions/:id/delete')
  async deleteSubscription(ctx: ContextManager, request: Request) {
    return this.respond(() => this.rss.remove(ctx, resourceId(request)))
  }
  @Post('/subscriptions/:id/refresh')
  async refreshSubscription(ctx: ContextManager, request: Request) {
    return this.respond(() => this.rss.refresh(ctx, resourceId(request)))
  }
  @Get('/entries')
  async listEntries(ctx: ContextManager, request: Request) {
    return this.respond(async () => this.rss.entries(ctx, await RequestUtils.query<RssEntriesQuery>(request)))
  }
  @Get('/entries/:id')
  async entry(ctx: ContextManager, request: Request) {
    return this.respond(() => this.rss.detail(ctx, resourceId(request)))
  }
  @Post('/entries/:id/save')
  async saveEntry(ctx: ContextManager, request: Request) {
    return this.respond(() => this.rss.save(ctx, resourceId(request)))
  }
}
