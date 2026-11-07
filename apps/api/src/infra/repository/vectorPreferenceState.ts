import { injectable } from '@/decorators/di'
import { packEntries, packSum, unpackEntries, unpackSum, type PreferenceState } from '@/utils/preferenceLedger'

export interface PreferenceStateStore {
  read(target: string): Promise<PreferenceState | null>
  insert(target: string, state: PreferenceState): Promise<boolean>
  update(target: string, expectedVersion: number, state: PreferenceState): Promise<boolean>
  delete(target: string, expectedVersion: number): Promise<boolean>
}

type StateRow = { version: number; mean_version: string; raw: unknown; centered: unknown; entries: unknown }

function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (Array.isArray(value)) return Uint8Array.from(value)
  throw new Error('invalid_preference_state')
}

const blob = (value: Uint8Array): ArrayBuffer => value.slice().buffer

@injectable()
export class VectorPreferenceStateRepo implements PreferenceStateStore {
  private readonly db: D1Database

  constructor(env: Env) {
    this.db = env.DB
  }

  async read(target: string): Promise<PreferenceState | null> {
    const row = await this.db.prepare('SELECT version, mean_version, raw, centered, entries FROM slax_vector_preference_state WHERE target = ?').bind(target).first<StateRow>()
    if (!row) return null
    const version = Number(row.version)
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalid_preference_state')
    return { version, meanVersion: row.mean_version, raw: unpackSum(bytes(row.raw)), centered: unpackSum(bytes(row.centered)), entries: unpackEntries(bytes(row.entries)) }
  }

  async insert(target: string, state: PreferenceState): Promise<boolean> {
    const result = await this.db
      .prepare(
        'INSERT INTO slax_vector_preference_state (target, version, mean_version, raw, centered, entries, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(target) DO NOTHING'
      )
      .bind(target, state.version, state.meanVersion, blob(packSum(state.raw)), blob(packSum(state.centered)), blob(packEntries(state.entries)))
      .run()
    return result.meta.changes === 1
  }

  async update(target: string, expectedVersion: number, state: PreferenceState): Promise<boolean> {
    const result = await this.db
      .prepare(
        'UPDATE slax_vector_preference_state SET version = ?, mean_version = ?, raw = ?, centered = ?, entries = ?, updated_at = CURRENT_TIMESTAMP WHERE target = ? AND version = ?'
      )
      .bind(state.version, state.meanVersion, blob(packSum(state.raw)), blob(packSum(state.centered)), blob(packEntries(state.entries)), target, expectedVersion)
      .run()
    return result.meta.changes === 1
  }

  async delete(target: string, expectedVersion: number): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM slax_vector_preference_state WHERE target = ? AND version = ?').bind(target, expectedVersion).run()
    return result.meta.changes === 1
  }
}
