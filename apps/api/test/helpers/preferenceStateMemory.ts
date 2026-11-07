import type { VectorPreferenceStateRepo } from '@/infra/repository/vectorPreferenceState'
import { packEntries, packSum, unpackEntries, unpackSum, type PreferenceState } from '@/utils/preferenceLedger'

type Stored = { version: number; meanVersion: string; raw: Uint8Array; centered: Uint8Array; entries: Uint8Array }

export function memoryPreferenceStates() {
  const rows = new Map<string, Stored>()
  const pack = (state: PreferenceState): Stored => ({
    version: state.version,
    meanVersion: state.meanVersion,
    raw: packSum(state.raw),
    centered: packSum(state.centered),
    entries: packEntries(state.entries)
  })
  const store = {
    rows,
    async read(target: string): Promise<PreferenceState | null> {
      const row = rows.get(target)
      return row ? { version: row.version, meanVersion: row.meanVersion, raw: unpackSum(row.raw), centered: unpackSum(row.centered), entries: unpackEntries(row.entries) } : null
    },
    async insert(target: string, state: PreferenceState) {
      if (rows.has(target)) return false
      rows.set(target, pack(state))
      return true
    },
    async update(target: string, expectedVersion: number, state: PreferenceState) {
      if (rows.get(target)?.version !== expectedVersion) return false
      rows.set(target, pack(state))
      return true
    },
    async delete(target: string, expectedVersion: number) {
      if (rows.get(target)?.version !== expectedVersion) return false
      rows.delete(target)
      return true
    }
  }
  return store as typeof store & VectorPreferenceStateRepo
}
