import type { ContextManager } from '@/utils/context'
import type { VectorTarget, VectorRefreshResult } from '@/utils/vectorMaintenanceTypes'

export type VectorMaintenanceEvent = VectorTarget & { mode?: 'relation' }

export interface VectorMaintenanceWorkflowParams {
  eventId?: string
  target: VectorMaintenanceEvent
  acceptedArticle?: VectorRefreshResult
}

export type VectorMaintenanceDispatchEnv = Pick<Env, 'VECTOR_V5_MAINTENANCE_WORKFLOW'>

export const vectorMaintenanceKey = (target: VectorMaintenanceEvent): string => {
  switch (target.kind) {
    case 'article':
      return `article:${target.userId}:${target.id}`
    case 'user':
      return `user:${target.id}:${target.preference}`
    case 'collection':
      return `collection:${target.id}`
  }
}

export const enqueueVectorMaintenance = async (env: VectorMaintenanceDispatchEnv, target: VectorMaintenanceEvent, acceptedArticle?: VectorRefreshResult): Promise<void> => {
  const binding = env.VECTOR_V5_MAINTENANCE_WORKFLOW
  if (!binding) throw new Error('missing_vector_maintenance_workflow')
  const eventId = crypto.randomUUID()
  await binding.create({ id: `v5-${eventId}`, params: { eventId, target, ...(acceptedArticle ? { acceptedArticle } : {}) } })
}

export const enqueueVectorMaintenanceBatch = async (env: VectorMaintenanceDispatchEnv, targets: VectorMaintenanceEvent[]): Promise<void> => {
  const selected = new Map<string, VectorMaintenanceEvent>()
  for (const target of targets) {
    const key = vectorMaintenanceKey(target),
      previous = selected.get(key)
    if (!previous || target.kind !== 'article' || target.mode !== 'relation' || previous.mode === 'relation') selected.set(key, target)
  }
  const unique = [...selected.values()]
  if (!unique.length) return
  const binding = env.VECTOR_V5_MAINTENANCE_WORKFLOW
  if (!binding) throw new Error('missing_vector_maintenance_workflow')
  for (let offset = 0; offset < unique.length; offset += 100) {
    await binding.createBatch(
      unique.slice(offset, offset + 100).map(target => {
        const eventId = crypto.randomUUID()
        return { id: `v5-${eventId}`, params: { eventId, target } }
      })
    )
  }
}

export const dispatchVectorMaintenance = (ctx: Pick<ContextManager, 'env' | 'execution'>, ...targets: VectorMaintenanceEvent[]): void => {
  ctx.execution.waitUntil(
    enqueueVectorMaintenanceBatch(ctx.env, targets).catch(error => {
      console.error('[vector-maintenance] dispatch failed', error)
    })
  )
}
