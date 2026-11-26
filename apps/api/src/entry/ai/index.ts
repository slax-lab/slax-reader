import { WorkerEntrypoint } from 'cloudflare:workers'
import { MultiLangError } from '@/utils/multiLangError'
import { Failed } from '@/utils/responseUtils'
import { ServerError } from '@/const/err'
import { container } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { initializeInfrastructure, initializeCore } from '@/di/generated/ai/dependency'
import { getRouter as aiRouter } from '@/di/generated/ai/aiRouter'
import { getRouter } from '@/di/router'
import { EDGE_RAY_ID_HEADER } from '@/const/edge'
import { applyApiResponseHeaders } from '@/middleware/cors'
import { VectorIndexRepo } from '@/infra/repository/vectorIndexRepo'
import type { VectorIndexKind, VectorIndexQueryOptions } from '@/utils/vectorMaintenanceTypes'

initializeCore()

export class AiEntry extends WorkerEntrypoint<Env> {
  private readonly vectors = new VectorIndexRepo(this.env)

  async upsertVectors(kind: VectorIndexKind, vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation> {
    return this.vectors.upsertVectors(kind, vectors)
  }

  async deleteVectorsByIds(kind: VectorIndexKind, ids: string[]): Promise<VectorizeAsyncMutation> {
    return this.vectors.deleteVectorsByIds(kind, ids)
  }

  async getVectorsByIds(kind: VectorIndexKind, ids: string[]): Promise<VectorizeVector[]> {
    return this.vectors.getVectorsByIds(kind, ids)
  }

  async queryVectors(kind: 'article' | 'collection', vector: number[], options: VectorIndexQueryOptions): Promise<{ id: string; score: number; values?: number[] }[]> {
    return this.vectors.queryVectors(kind, vector, options)
  }

  async query(shardIdx: number, vector: number[], topK?: number, filter?: VectorizeVectorMetadataFilter): Promise<VectorizeMatches> {
    return this.vectors.query(shardIdx, vector, topK, filter)
  }

  async upsert(shardIdx: number, vectors: VectorizeVector[]): Promise<VectorizeVectorMutation> {
    return this.vectors.upsert(shardIdx, vectors)
  }

  async deleteByIds(shardIdx: number, ids: string[]): Promise<VectorizeVectorMutation> {
    return this.vectors.deleteByIds(shardIdx, ids)
  }
}

async function handleFetch(request: Request, env: Env, ctx: ExecutionContext) {
  const currentContainer = container.clone()
  const ctxManager = new ContextManager(ctx, env)
  ctxManager.set('rayId', request.headers.get(EDGE_RAY_ID_HEADER) ?? '')

  const router = getRouter(new URL(request.url).host, currentContainer, env.BACKEND_API_PREFIX, aiRouter)
  if (!router) return Failed('host not found')

  initializeInfrastructure(ctxManager, currentContainer)

  const response = await router
    .fetch(request, ctxManager)
    .catch(err => {
      if (err instanceof MultiLangError) return Failed(err)
      console.error(err)
      return Failed(ServerError())
    })
    .then(res => {
      if (res instanceof Response) return res
      console.error(`[${request.method}] ${new URL(request.url).pathname} is not a response`)
      return Failed(ServerError())
    })
  await ctxManager.cleanup()

  return response
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return applyApiResponseHeaders(await handleFetch(request, env, ctx), request, env.FRONT_END_URL)
  }
}
