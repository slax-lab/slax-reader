import { DurableObject } from 'cloudflare:workers'
import { container } from '@/decorators/di'
import { initializeCore, initializeInfrastructure } from '@/di/generated/dependency'
import { ContextManager } from '@/utils/context'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { VectorPreferenceStores } from '@/infra/repository/vectorPreferenceStore'
import { readLegacyPreference } from '@/infra/repository/legacyPreferenceStorage'
import { PreferenceQueue, type PreferenceCall, type PreferencePublish, type PreferenceStore } from '@/utils/preferenceLedger'
import type { VectorPreferenceRpc } from '@/infra/repository/vectorPreferenceClient'
import type { VectorRefreshResult } from '@/utils/vectorMaintenanceTypes'

export class VectorPreferenceObject extends DurableObject<Env> implements VectorPreferenceRpc {
  private readonly queue = new PreferenceQueue(calls => this.run(calls))

  apply(userId: number, id: number, previous?: number[]): Promise<VectorRefreshResult[]> {
    return this.queue.submit({ kind: 'apply', userId, id, previous })
  }

  rebuild(userId: number, publish: PreferencePublish): Promise<VectorRefreshResult[]> {
    return this.queue.submit({ kind: 'rebuild', userId, publish })
  }

  publish(userId: number, publish: PreferencePublish): Promise<VectorRefreshResult[]> {
    return this.queue.submit({ kind: 'publish', userId, publish })
  }

  protected async open(): Promise<{ service: VectorMaintenanceService; stores: { forUser(userId: number): PreferenceStore }; close: () => Promise<void> }> {
    initializeCore()
    const ctx = new ContextManager(this.ctx as unknown as ExecutionContext, this.env)
    const scope = container.clone()
    initializeInfrastructure(ctx, scope)
    return { service: scope.resolve(VectorMaintenanceService), stores: scope.resolve(VectorPreferenceStores), close: () => ctx.cleanup() }
  }

  private async run(calls: PreferenceCall[]): Promise<VectorRefreshResult[]> {
    const { service, stores, close } = await this.open()
    try {
      const legacy = readLegacyPreference(this.ctx.storage)
      const results = await service.maintainPreference(stores.forUser(calls[0].userId), calls, legacy)
      if (legacy !== undefined) await this.ctx.storage.deleteAll()
      return results
    } finally {
      await close()
    }
  }
}
