import { injectable } from '@/decorators/di'
import type { PreferencePublish } from '@/utils/preferenceLedger'
import type { VectorRefreshResult } from '@/utils/vectorMaintenanceTypes'

export interface VectorPreferenceRpc {
  apply(userId: number, id: number, previous?: number[]): Promise<VectorRefreshResult[]>
  rebuild(userId: number, publish: PreferencePublish): Promise<VectorRefreshResult[]>
}

@injectable()
export class VectorPreferenceClient implements VectorPreferenceRpc {
  private readonly namespace?: DurableObjectNamespace

  constructor(env: Env) {
    this.namespace = env.VECTOR_V5_PREFERENCE as DurableObjectNamespace | undefined
  }

  private object(userId: number): VectorPreferenceRpc {
    if (!this.namespace) throw new Error('missing_vector_preference_object')
    return this.namespace.get(this.namespace.idFromName(String(userId))) as unknown as VectorPreferenceRpc
  }

  apply(userId: number, id: number, previous?: number[]): Promise<VectorRefreshResult[]> {
    return this.object(userId).apply(userId, id, previous)
  }

  rebuild(userId: number, publish: PreferencePublish): Promise<VectorRefreshResult[]> {
    return this.object(userId).rebuild(userId, publish)
  }
}
