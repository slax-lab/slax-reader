import type { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import type { VectorPreferenceClient } from '@/infra/repository/vectorPreferenceClient'
import {
  clonePreferenceSums,
  PreferenceQueue,
  type MemberGroup,
  type PreferenceEntry,
  type PreferencePublish,
  type PreferenceStore,
  type PreferenceSums
} from '@/utils/preferenceLedger'

export class MemoryPreferenceStore implements PreferenceStore {
  sums: PreferenceSums | null = null
  rows = new Map<number, PreferenceEntry>()

  read() {
    return this.sums && clonePreferenceSums(this.sums)
  }

  entries(ids: number[]) {
    return new Map(ids.flatMap(id => (this.rows.has(id) ? [[id, { ...this.rows.get(id)! }] as const] : [])))
  }

  firstMissing(groups: MemberGroup[]) {
    let first: number | undefined
    for (const [id, entry] of this.rows) if (!entry.token && (groups as string[]).includes(entry.group) && (first === undefined || id < first)) first = id
    return first
  }

  commit(sums: PreferenceSums, upserts: Map<number, PreferenceEntry>, deletes: number[]) {
    this.sums = clonePreferenceSums(sums)
    for (const [id, entry] of upserts) this.rows.set(id, { ...entry })
    for (const id of deletes) this.rows.delete(id)
  }

  replace(sums: PreferenceSums, entries: Map<number, PreferenceEntry>) {
    this.sums = clonePreferenceSums(sums)
    this.rows = new Map([...entries].map(([id, entry]) => [id, { ...entry }]))
  }

  async clear() {
    this.sums = null
    this.rows = new Map()
  }
}

export function memoryPreferences() {
  let service: VectorMaintenanceService | undefined
  const stores = new Map<number, MemoryPreferenceStore>()
  const queues = new Map<number, PreferenceQueue>()
  const batches: number[][] = []
  const store = (userId: number) => {
    if (!stores.has(userId)) stores.set(userId, new MemoryPreferenceStore())
    return stores.get(userId)!
  }
  const queue = (userId: number) => {
    if (!queues.has(userId))
      queues.set(
        userId,
        new PreferenceQueue(async calls => {
          if (!service) throw new Error('memory preferences are not bound to a service')
          batches.push(calls.map(call => (call.kind === 'apply' ? call.id : 0)))
          return structuredClone(await service.maintainPreference(store(userId), calls))
        })
      )
    return queues.get(userId)!
  }
  const client = {
    apply: (userId: number, id: number, previous?: number[]) => queue(userId).submit({ kind: 'apply', userId, id, previous: previous && [...previous] }),
    rebuild: (userId: number, publish: PreferencePublish) => queue(userId).submit({ kind: 'rebuild', userId, publish }),
    publish: (userId: number, publish: PreferencePublish) => queue(userId).submit({ kind: 'publish', userId, publish })
  }
  return {
    client: client as unknown as VectorPreferenceClient,
    store,
    stores,
    batches,
    bind(target: VectorMaintenanceService) {
      service = target
      return target
    }
  }
}
