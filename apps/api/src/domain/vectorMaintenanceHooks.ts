import type { ContextManager } from '@/utils/context'
import type { VectorTarget } from '@/utils/vectorMaintenanceTypes'

export type VectorMaintenanceEvent = VectorTarget

export interface VectorMaintenanceWorkflowParams {
  eventId?: string
  target: VectorMaintenanceEvent
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

export const enqueueVectorMaintenance = async (env: VectorMaintenanceDispatchEnv, target: VectorMaintenanceEvent): Promise<void> => {
  const binding = env.VECTOR_V5_MAINTENANCE_WORKFLOW
  if (!binding) throw new Error('missing_vector_maintenance_workflow')
  const eventId = crypto.randomUUID()
  await binding.create({ id: `v5-${eventId}`, params: { eventId, target } })
}

export const enqueueVectorMaintenanceBatch = async (env: VectorMaintenanceDispatchEnv, targets: VectorMaintenanceEvent[]): Promise<void> => {
  const unique = [...new Map(targets.map(target => [vectorMaintenanceKey(target), target])).values()]
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
