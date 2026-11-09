import { DurableObject } from 'cloudflare:workers'
import { container } from '@/decorators/di'
import { initializeCore, initializeInfrastructure } from '@/di/generated/dependency'
import { ContextManager } from '@/utils/context'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { SqlPreferenceStore } from '@/infra/repository/vectorPreferenceStore'
import { PreferenceQueue, type PreferenceCall, type PreferencePublish, type PreferenceStore } from '@/utils/preferenceLedger'
import type { VectorPreferenceRpc } from '@/infra/repository/vectorPreferenceClient'
import type { VectorRefreshResult } from '@/utils/vectorMaintenanceTypes'

export class VectorPreferenceObject extends DurableObject<Env> implements VectorPreferenceRpc {
  protected readonly store: PreferenceStore = new SqlPreferenceStore(this.ctx.storage)
  private readonly queue = new PreferenceQueue(calls => this.run(calls))

  apply(userId: number, id: number, previous?: number[]): Promise<VectorRefreshResult[]> {
    return this.queue.submit({ kind: 'apply', userId, id, previous })
  }

  rebuild(userId: number, publish: PreferencePublish): Promise<VectorRefreshResult[]> {
    return this.queue.submit({ kind: 'rebuild', userId, publish })
  }

  protected async open(): Promise<{ service: VectorMaintenanceService; close: () => Promise<void> }> {
    initializeCore()
    const ctx = new ContextManager(this.ctx as unknown as ExecutionContext, this.env)
    const scope = container.clone()
    initializeInfrastructure(ctx, scope)
    return { service: scope.resolve(VectorMaintenanceService), close: () => ctx.cleanup() }
  }

  private async run(calls: PreferenceCall[]): Promise<VectorRefreshResult[]> {
    const { service, close } = await this.open()
    try {
      return await service.maintainPreference(this.store, calls)
    } finally {
      await close()
    }
  }
}
