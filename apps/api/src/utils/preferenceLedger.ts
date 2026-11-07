import { center } from './recommendationAlgorithms'
import { normalized, VECTOR_DIMENSIONS } from './vectorEmbedding'

export type PreferenceTargetKind = 'user-article' | 'owner-collection'

export interface PreferenceEntry {
  weight: number
  token: string
}

export interface PreferenceState {
  version: number
  meanVersion: string
  raw: Float64Array
  centered: Float64Array
  entries: Map<number, PreferenceEntry>
}

const ENTRY_BYTES = 16
const SUM_BYTES = VECTOR_DIMENSIONS * Float64Array.BYTES_PER_ELEMENT
const EMPTY_TOKEN = '0000000000000000'
export const PREFERENCE_STATE_MAX_ENTRIES = 120_000

export const preferenceStateKey = (kind: PreferenceTargetKind, id: number): string => `state:${kind}:${id}`

export function emptyPreferenceState(meanVersion: string): PreferenceState {
  return { version: 0, meanVersion, raw: new Float64Array(VECTOR_DIMENSIONS), centered: new Float64Array(VECTOR_DIMENSIONS), entries: new Map() }
}

export function nextPreferenceVersion(previous: number): number {
  return Math.max(previous + 1, Date.now())
}

export function vectorToken(values: ArrayLike<number>): string {
  if (values.length !== VECTOR_DIMENSIONS) throw new Error('invalid_vector_dimensions')
  const words = new Uint32Array(Float32Array.from(values).buffer)
  let high = 0x811c9dc5
  let low = 0x9747b28c
  for (let i = 0; i < words.length; i++) {
    high = Math.imul(high ^ words[i], 0x01000193)
    low = Math.imul(low ^ words[i], 0x5bd1e995)
    low ^= low >>> 15
  }
  const token = (high >>> 0).toString(16).padStart(8, '0') + (low >>> 0).toString(16).padStart(8, '0')
  return token === EMPTY_TOKEN ? '0000000000000001' : token
}

export function addContribution(state: PreferenceState, kind: PreferenceTargetKind, values: ArrayLike<number>, weight: number) {
  if (!weight) return
  const unit = normalized(values)
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) state.raw[i] += weight * unit[i]
  if (kind !== 'user-article') return
  const centered = center(unit)
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) state.centered[i] += weight * centered[i]
}

export function preferenceCoverage(state: PreferenceState): { eligible: number; used: number; missing: number } {
  let used = 0
  for (const entry of state.entries.values()) if (entry.token) used++
  return { eligible: state.entries.size, used, missing: state.entries.size - used }
}

export function firstMissingEntry(state: PreferenceState): number | undefined {
  let first: number | undefined
  for (const [id, entry] of state.entries) if (!entry.token && (first === undefined || id < first)) first = id
  return first
}

export function packEntries(entries: Map<number, PreferenceEntry>): Uint8Array {
  if (entries.size > PREFERENCE_STATE_MAX_ENTRIES) throw new Error('preference_state_too_large')
  const ids = [...entries.keys()].sort((a, b) => a - b)
  const bytes = new Uint8Array(ids.length * ENTRY_BYTES)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < ids.length; i++) {
    const entry = entries.get(ids[i])!
    if (!Number.isSafeInteger(ids[i]) || ids[i] < 1 || ids[i] > 0xffffffff) throw new Error('invalid_preference_entry')
    if (!Number.isInteger(entry.weight) || entry.weight < 1 || entry.weight > 0xffff) throw new Error('invalid_preference_entry')
    if (entry.token && !/^[0-9a-f]{16}$/.test(entry.token)) throw new Error('invalid_preference_entry')
    const token = entry.token || EMPTY_TOKEN
    const offset = i * ENTRY_BYTES
    view.setUint32(offset, ids[i], true)
    view.setUint16(offset + 4, entry.weight, true)
    view.setUint32(offset + 8, Number.parseInt(token.slice(0, 8), 16), true)
    view.setUint32(offset + 12, Number.parseInt(token.slice(8), 16), true)
  }
  return bytes
}

export function unpackEntries(bytes: Uint8Array): Map<number, PreferenceEntry> {
  if (bytes.length % ENTRY_BYTES) throw new Error('invalid_preference_state')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = new Map<number, PreferenceEntry>()
  for (let offset = 0; offset < bytes.length; offset += ENTRY_BYTES) {
    const id = view.getUint32(offset, true)
    const weight = view.getUint16(offset + 4, true)
    if (!id || !weight || entries.has(id)) throw new Error('invalid_preference_state')
    const token =
      view
        .getUint32(offset + 8, true)
        .toString(16)
        .padStart(8, '0') +
      view
        .getUint32(offset + 12, true)
        .toString(16)
        .padStart(8, '0')
    entries.set(id, { weight, token: token === EMPTY_TOKEN ? '' : token })
  }
  return entries
}

export function packSum(sum: Float64Array): Uint8Array {
  if (sum.length !== VECTOR_DIMENSIONS) throw new Error('invalid_vector_dimensions')
  if (sum.every(value => value === 0)) return new Uint8Array()
  return new Uint8Array(sum.slice().buffer)
}

export function unpackSum(bytes: Uint8Array): Float64Array {
  if (!bytes.length) return new Float64Array(VECTOR_DIMENSIONS)
  if (bytes.length !== SUM_BYTES) throw new Error('invalid_preference_state')
  const sum = new Float64Array(bytes.slice().buffer)
  if (!sum.every(Number.isFinite)) throw new Error('invalid_preference_state')
  return sum
}
