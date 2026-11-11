import { center } from './recommendationAlgorithms'
import { normalized, VECTOR_DIMENSIONS } from './vectorEmbedding'
import type { VectorRefreshResult } from './vectorMaintenanceTypes'

export type InterestPair = [medoidBookmarkId: number, importance: number]

export type ShareGroup = 'none' | 'shared' | 'inherited'
export type MemberGroup = Exclude<ShareGroup, 'none'>

export interface GroupCounts {
  members: number
  missing: number
}

export interface PreferenceCounts {
  eligible: number
  used: number
  shared: GroupCounts
  inherited: GroupCounts
}

export interface PreferenceSums {
  seq: number
  meanVersion: string
  raw: Float64Array
  centered: Float64Array
  shared: Float64Array
  inherited: Float64Array
  counts: PreferenceCounts
  interests: InterestPair[]
}

export interface PreferenceEntry {
  weight: number
  group: ShareGroup
  token: string
  values?: number[]
  publishedAt?: number
  actions?: number[]
}

export interface PreferenceStore {
  read(): PreferenceSums | null
  entries(ids: number[]): Map<number, PreferenceEntry>
  latestPublication(groups: MemberGroup[]): number
  recentEntries(since: number, limit: number): Map<number, PreferenceEntry>
  commit(sums: PreferenceSums, upserts: Map<number, PreferenceEntry>, deletes: number[]): void
  replace(sums: PreferenceSums, entries: Map<number, PreferenceEntry>): void
  beginInitialization(): void
  appendInitialization(entries: Map<number, PreferenceEntry>): void
  finishInitialization(sums: PreferenceSums): void
  clear(): Promise<void>
}

export type PreferencePublish = { user: boolean; collections: 'all' | number[] }

export type PreferenceCall =
  | { kind: 'apply'; userId: number; id: number; previous?: number[] }
  | { kind: 'rebuild'; userId: number; publish: PreferencePublish }
  | { kind: 'publish'; userId: number; publish: PreferencePublish }

export function publicationScope(calls: PreferenceCall[]): PreferencePublish {
  if (calls.some(call => call.kind === 'apply')) return { user: true, collections: 'all' }
  const scopes = calls.flatMap(call => (call.kind === 'apply' ? [] : [call.publish]))
  if (scopes.some(scope => scope.collections === 'all')) return { user: scopes.some(scope => scope.user), collections: 'all' }
  return { user: scopes.some(scope => scope.user), collections: [...new Set(scopes.flatMap(scope => scope.collections as number[]))] }
}

const SUM_BYTES = VECTOR_DIMENSIONS * Float64Array.BYTES_PER_ELEMENT
export const PREFERENCE_BATCH_SIZE = 100

export function emptyPreferenceSums(meanVersion: string, seq: number): PreferenceSums {
  return {
    seq,
    meanVersion,
    raw: new Float64Array(VECTOR_DIMENSIONS),
    centered: new Float64Array(VECTOR_DIMENSIONS),
    shared: new Float64Array(VECTOR_DIMENSIONS),
    inherited: new Float64Array(VECTOR_DIMENSIONS),
    counts: { eligible: 0, used: 0, shared: { members: 0, missing: 0 }, inherited: { members: 0, missing: 0 } },
    interests: []
  }
}

export function clonePreferenceSums(sums: PreferenceSums): PreferenceSums {
  return {
    ...sums,
    raw: sums.raw.slice(),
    centered: sums.centered.slice(),
    shared: sums.shared.slice(),
    inherited: sums.inherited.slice(),
    counts: { ...sums.counts, shared: { ...sums.counts.shared }, inherited: { ...sums.counts.inherited } },
    interests: sums.interests.map(pair => [...pair] as InterestPair)
  }
}

export function nextPreferenceSeq(previous: number): number {
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
  return (high >>> 0).toString(16).padStart(8, '0') + (low >>> 0).toString(16).padStart(8, '0')
}

export function addEntry(sums: PreferenceSums, entry: PreferenceEntry, values: ArrayLike<number> | undefined, sign: 1 | -1) {
  if (!entry.token !== !values) throw new Error('invalid_preference_state')
  sums.counts.eligible += sign
  if (values) sums.counts.used += sign
  const group = entry.group === 'none' ? undefined : sums.counts[entry.group]
  if (group) {
    group.members += sign
    if (!values) group.missing += sign
  }
  if (!values) return
  const unit = normalized(values)
  const centered = center(unit)
  const owner = entry.group === 'none' ? undefined : sums[entry.group]
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
    sums.raw[i] += sign * entry.weight * unit[i]
    sums.centered[i] += sign * entry.weight * centered[i]
    if (owner) owner[i] += sign * unit[i]
  }
}

export function validCounts(counts: PreferenceCounts): boolean {
  const count = (value: number) => Number.isSafeInteger(value) && value >= 0
  const group = (value: GroupCounts) => count(value.members) && count(value.missing) && value.missing <= value.members
  return (
    count(counts.eligible) &&
    count(counts.used) &&
    counts.used <= counts.eligible &&
    group(counts.shared) &&
    group(counts.inherited) &&
    counts.shared.members + counts.inherited.members <= counts.eligible &&
    counts.shared.missing + counts.inherited.missing <= counts.eligible - counts.used
  )
}

export function settlePreferenceSums(sums: PreferenceSums) {
  if (!validCounts(sums.counts)) throw new Error('invalid_preference_state')
  if (!sums.counts.used) {
    sums.raw.fill(0)
    sums.centered.fill(0)
  }
  for (const group of ['shared', 'inherited'] as const) if (sums.counts[group].members === sums.counts[group].missing) sums[group].fill(0)
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

export function parseInterests(text: string): InterestPair[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('invalid_preference_state')
  }
  if (!Array.isArray(parsed)) throw new Error('invalid_preference_state')
  for (const pair of parsed)
    if (!Array.isArray(pair) || pair.length !== 2 || !Number.isSafeInteger(pair[0]) || pair[0] < 1 || typeof pair[1] !== 'number' || !Number.isFinite(pair[1]))
      throw new Error('invalid_preference_state')
  return parsed as InterestPair[]
}

type Waiter = { call: PreferenceCall; resolve: (results: VectorRefreshResult[]) => void; reject: (error: unknown) => void }

export class PreferenceQueue {
  private waiting: Waiter[] = []
  private draining = false

  constructor(private readonly run: (calls: PreferenceCall[]) => Promise<VectorRefreshResult[]>) {}

  submit(call: PreferenceCall): Promise<VectorRefreshResult[]> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ call, resolve, reject })
      if (!this.draining) {
        this.draining = true
        void this.drain()
      }
    })
  }

  private async drain() {
    for (;;) {
      if (!this.waiting.length) {
        this.draining = false
        return
      }
      const userId = this.waiting[0].call.userId
      let count = 0
      while (count < this.waiting.length && count < PREFERENCE_BATCH_SIZE && this.waiting[count].call.userId === userId) count++
      const batch = this.waiting.splice(0, count)
      try {
        const results = await this.run(batch.map(waiter => waiter.call))
        for (const waiter of batch) waiter.resolve(results)
      } catch (error) {
        for (const waiter of batch) waiter.reject(error)
      }
    }
  }
}
