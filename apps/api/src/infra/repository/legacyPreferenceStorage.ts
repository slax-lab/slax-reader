import { parseInterests, unpackSum, validCounts, type LocalPreference, type PreferenceCounts, type PreferenceEntry, type ShareGroup } from '@/utils/preferenceLedger'

const GROUPS: ShareGroup[] = ['none', 'shared', 'inherited']
const LAYOUTS = [
  { state: 'preference_state_v3', entry: 'preference_entry_v3', publication: true },
  { state: 'preference_state_v2', entry: 'preference_entry_v2', publication: false }
]

type StateRow = { seq: number; mean_version: string; raw: ArrayBuffer; centered: ArrayBuffer; shared: ArrayBuffer; inherited: ArrayBuffer; counts: string; interests: string }
type EntryRow = { bookmark_id: number; weight: number; share_group: number; token: string; published_at?: number }

function counts(text: string): PreferenceCounts | null {
  try {
    const parsed = JSON.parse(text) as PreferenceCounts
    return parsed && parsed.shared && parsed.inherited && validCounts(parsed) ? parsed : null
  } catch {
    return null
  }
}

function tables(storage: DurableObjectStorage): Set<string> {
  return new Set(
    storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'preference_%'")
      .toArray()
      .map(row => row.name)
  )
}

export function hasLegacyPreference(storage: DurableObjectStorage): boolean {
  return tables(storage).size > 0
}

export function readLegacyPreference(storage: DurableObjectStorage): LocalPreference | null {
  const present = tables(storage)
  for (const layout of LAYOUTS) {
    if (!present.has(layout.state) || !present.has(layout.entry)) continue
    try {
      const row = storage.sql.exec<StateRow>(`SELECT seq, mean_version, raw, centered, shared, inherited, counts, interests FROM ${layout.state} WHERE id = 1`).toArray()[0]
      const parsed = row && counts(row.counts)
      if (!row || !parsed || !Number.isSafeInteger(row.seq) || row.seq < 1) return null
      const columns = layout.publication ? 'bookmark_id, weight, share_group, token, published_at' : 'bookmark_id, weight, share_group, token'
      const entries = new Map<number, PreferenceEntry>()
      for (const entry of storage.sql.exec<EntryRow>(`SELECT ${columns} FROM ${layout.entry}`)) {
        const group = GROUPS[entry.share_group]
        if (!group || !Number.isSafeInteger(entry.weight) || entry.weight < 1 || (entry.token && !/^[0-9a-f]{16}$/.test(entry.token))) return null
        entries.set(entry.bookmark_id, { weight: entry.weight, group, token: entry.token, publishedAt: Number(entry.published_at) || 0 })
      }
      return {
        publication: layout.publication,
        entries,
        sums: {
          seq: row.seq,
          meanVersion: row.mean_version,
          raw: unpackSum(new Uint8Array(row.raw)),
          centered: unpackSum(new Uint8Array(row.centered)),
          shared: unpackSum(new Uint8Array(row.shared)),
          inherited: unpackSum(new Uint8Array(row.inherited)),
          counts: parsed,
          interests: parseInterests(row.interests)
        }
      }
    } catch {
      return null
    }
  }
  return null
}
