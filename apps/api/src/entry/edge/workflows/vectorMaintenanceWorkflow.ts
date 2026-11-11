import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { container } from '@/decorators/di'
import { initializeCore, initializeInfrastructure } from '@/di/generated/dependency'
import { ContextManager } from '@/utils/context'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { VectorMaintenanceRepo } from '@/infra/repository/dbVectorMaintenance'
import { CollectionRepo } from '@/infra/repository/dbCollection'
import type { VectorMaintenanceEvent, VectorMaintenanceWorkflowParams } from '@/domain/vectorMaintenanceHooks'
import { articleVectorId, type VectorRefreshResult, type VectorTarget } from '@/utils/vectorMaintenanceTypes'

const PAGE_SIZE = 25
const retry = { retries: { limit: 5, delay: '10 seconds' as const, backoff: 'exponential' as const }, timeout: '10 minutes' as const }

export const validateMaintenanceEvent = (target: VectorMaintenanceEvent): void => {
  const validId = (id: number) => Number.isSafeInteger(id) && id > 0
  if (!target || typeof target !== 'object') throw new Error('invalid_vector_maintenance_event')
  switch (target.kind) {
    case 'article':
      if (validId(target.id) && validId(target.userId)) return
      break
    case 'collection':
      if (validId(target.id)) return
      break
    case 'user':
      if (validId(target.id) && ['article', 'collection'].includes(target.preference)) return
  }
  throw new Error('invalid_vector_maintenance_event')
}

export const requireRefreshSuccess = (result: VectorRefreshResult): VectorRefreshResult => {
  if (result.state === 'failed') throw new Error(result.reason || 'vector_refresh_failed')
  if (result.state === 'written' && !result.vectorIds.length) throw new Error('vector_refresh_missing_ids')
  return result
}

export const verifyVectorVisibility = async (service: VectorMaintenanceService, result: VectorRefreshResult): Promise<void> => {
  requireRefreshSuccess(result)
  if (!(await service.verifyRefresh(result))) throw new Error('vector_mutation_not_visible')
}

export class VectorMaintenanceWorkflow extends WorkflowEntrypoint<Env, VectorMaintenanceWorkflowParams> {
  private async refresh(service: VectorMaintenanceService, target: Exclude<VectorTarget, { kind: 'article' }>, step: WorkflowStep, name: string) {
    const result = await step.do(`${name}-write`, retry, async () =>
      requireRefreshSuccess(await (target.kind === 'collection' ? service.refreshCollection(target.id) : service.refreshUser(target.id, target.preference)))
    )
    await step.do(`${name}-visible`, retry, () => verifyVectorVisibility(service, result))
    return result
  }

  async run(event: WorkflowEvent<VectorMaintenanceWorkflowParams>, step: WorkflowStep) {
    const { target, eventId } = event.payload
    validateMaintenanceEvent(target)
    if (eventId !== undefined && (typeof eventId !== 'string' || !eventId)) throw new Error('invalid_vector_maintenance_event')

    initializeCore()
    const currentContainer = container.clone()
    const ctxManager = new ContextManager(this.ctx, this.env)
    try {
      initializeInfrastructure(ctxManager, currentContainer)
      const service = currentContainer.resolve(VectorMaintenanceService)
      const repo = currentContainer.resolve(VectorMaintenanceRepo)

      if (target.kind === 'article') {
        const identity = { userId: target.userId, id: target.id }
        const written = await step.do('article-write', retry, async () => {
          const { results, previous } = await service.refreshArticlesWithPrevious([identity])
          if (results.length !== 1) throw new Error('vector_refresh_missing_result')
          return { result: requireRefreshSuccess(results[0]), previous: previous[articleVectorId(identity)] ?? null }
        })
        await step.do('article-visible', retry, () => verifyVectorVisibility(service, written.result))
        await step.do('preference', retry, async () => {
          for (const result of await service.applyArticle(identity, written.previous ?? undefined)) await verifyVectorVisibility(service, result)
        })
        return
      }

      if (target.kind === 'collection') {
        const collectionRepo = currentContainer.resolve(CollectionRepo)
        const collection = await step.do('collection-owner', retry, async () => {
          const row = await collectionRepo.getUserShareCollectById(target.id)
          return row ? { owner_id: row.owner_id } : null
        })
        if (collection) {
          let cursor = 0
          for (let page = 0; ; page++) {
            const rows = await step.do(`collection-members-${page}`, retry, () => repo.listOwnerArticles(collection.owner_id, cursor, PAGE_SIZE))
            if (rows.length) {
              const results = await step.do(`collection-members-${page}-write`, retry, async () => {
                const refreshed = await service.refreshArticles(rows.map(row => ({ userId: row.user_id, id: row.bookmark_id })))
                if (refreshed.length !== rows.length) throw new Error('vector_refresh_missing_result')
                return refreshed.map(requireRefreshSuccess)
              })
              await step.do(`collection-members-${page}-visible`, retry, async () => {
                for (const result of results) await verifyVectorVisibility(service, result)
              })
            }
            if (rows.length < PAGE_SIZE) break
            cursor = rows[rows.length - 1].id
          }
        }
        await this.refresh(service, target, step, `collection-${target.id}`)
        return
      }

      if (target.kind === 'user') {
        await this.refresh(service, target, step, target.preference === 'collection' ? 'retire-collection-preference' : 'article-preference')
      }
    } finally {
      await ctxManager.cleanup()
    }
  }
}
