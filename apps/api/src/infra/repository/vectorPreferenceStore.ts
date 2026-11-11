import {
  packSum,
  parseInterests,
  unpackSum,
  validCounts,
  type MemberGroup,
  type PreferenceCounts,
  type PreferenceEntry,
  type PreferenceStore,
  type PreferenceSums,
  type ShareGroup
} from '@/utils/preferenceLedger'

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS preference_state_v2 (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, mean_version TEXT NOT NULL, raw BLOB NOT NULL, centered BLOB NOT NULL, shared BLOB NOT NULL, inherited BLOB NOT NULL, counts TEXT NOT NULL, interests TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS preference_entry_v2 (bookmark_id INTEGER PRIMARY KEY, weight INTEGER NOT NULL, share_group INTEGER NOT NULL, token TEXT NOT NULL)',
  "CREATE INDEX IF NOT EXISTS preference_entry_v2_missing ON preference_entry_v2 (share_group, bookmark_id) WHERE token = ''"
]
const LEGACY_TABLES = ['preference_state', 'preference_entry']
const BIND_LIMIT = 90
const GROUPS: ShareGroup[] = ['none', 'shared', 'inherited']

type StateRow = { seq: number; mean_version: string; raw: ArrayBuffer; centered: ArrayBuffer; shared: ArrayBuffer; inherited: ArrayBuffer; counts: string; interests: string }
type EntryRow = { bookmark_id: number; weight: number; share_group: number; token: string }

const blob = (sum: Float64Array): ArrayBuffer => packSum(sum).slice().buffer

function entry(row: EntryRow): PreferenceEntry {
  const group = GROUPS[row.share_group]
  if (!Number.isSafeInteger(row.weight) || row.weight < 1 || !group || (row.token && !/^[0-9a-f]{16}$/.test(row.token))) throw new Error('invalid_preference_state')
  return { weight: row.weight, group, token: row.token }
}

function counts(text: string): PreferenceCounts {
  let parsed: PreferenceCounts
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('invalid_preference_state')
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.shared || !parsed.inherited || !validCounts(parsed)) throw new Error('invalid_preference_state')
  return { eligible: parsed.eligible, used: parsed.used, shared: { ...parsed.shared }, inherited: { ...parsed.inherited } }
}

export class SqlPreferenceStore implements PreferenceStore {
  private ready = false

  constructor(private readonly storage: DurableObjectStorage) {}

  private get sql() {
    if (!this.ready) {
      for (const statement of SCHEMA) this.storage.sql.exec(statement)
      this.ready = true
    }
    return this.storage.sql
  }

  read(): PreferenceSums | null {
    if (this.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('preference_state', 'preference_entry') LIMIT 1").toArray().length) return null
    const rows = this.sql.exec<StateRow>('SELECT seq, mean_version, raw, centered, shared, inherited, counts, interests FROM preference_state_v2 WHERE id = 1').toArray()
    if (!rows.length) return null
    const row = rows[0]
    if (!Number.isSafeInteger(row.seq) || row.seq < 1) throw new Error('invalid_preference_state')
    return {
      seq: row.seq,
      meanVersion: row.mean_version,
      raw: unpackSum(new Uint8Array(row.raw)),
      centered: unpackSum(new Uint8Array(row.centered)),
      shared: unpackSum(new Uint8Array(row.shared)),
      inherited: unpackSum(new Uint8Array(row.inherited)),
      counts: counts(row.counts),
      interests: parseInterests(row.interests)
    }
  }

  entries(ids: number[]): Map<number, PreferenceEntry> {
    const found = new Map<number, PreferenceEntry>()
    for (let offset = 0; offset < ids.length; offset += BIND_LIMIT) {
      const page = ids.slice(offset, offset + BIND_LIMIT)
      const cursor = this.sql.exec<EntryRow>(
        `SELECT bookmark_id, weight, share_group, token FROM preference_entry_v2 WHERE bookmark_id IN (${page.map(() => '?').join(',')})`,
        ...page
      )
      for (const row of cursor) found.set(row.bookmark_id, entry(row))
    }
    return found
  }

  firstMissing(groups: MemberGroup[]): number | undefined {
    let first: number | undefined
    for (const group of groups) {
      const row = this.sql.exec<{ id: number | null }>("SELECT MIN(bookmark_id) AS id FROM preference_entry_v2 WHERE token = '' AND share_group = ?", GROUPS.indexOf(group)).one()
      if (row.id !== null && (first === undefined || row.id < first)) first = row.id
    }
    return first
  }

  private writeState(sums: PreferenceSums) {
    this.sql.exec(
      'INSERT INTO preference_state_v2 (id, seq, mean_version, raw, centered, shared, inherited, counts, interests) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET seq = excluded.seq, mean_version = excluded.mean_version, raw = excluded.raw, centered = excluded.centered, shared = excluded.shared, inherited = excluded.inherited, counts = excluded.counts, interests = excluded.interests',
      sums.seq,
      sums.meanVersion,
      blob(sums.raw),
      blob(sums.centered),
      blob(sums.shared),
      blob(sums.inherited),
      JSON.stringify(sums.counts),
      JSON.stringify(sums.interests)
    )
  }

  private writeEntries(entries: Map<number, PreferenceEntry>) {
    for (const [id, value] of entries)
      this.sql.exec(
        'INSERT INTO preference_entry_v2 (bookmark_id, weight, share_group, token) VALUES (?, ?, ?, ?) ON CONFLICT (bookmark_id) DO UPDATE SET weight = excluded.weight, share_group = excluded.share_group, token = excluded.token',
        id,
        value.weight,
        GROUPS.indexOf(value.group),
        value.token
      )
  }

  commit(sums: PreferenceSums, upserts: Map<number, PreferenceEntry>, deletes: number[]) {
    const sql = this.sql
    this.storage.transactionSync(() => {
      this.writeState(sums)
      this.writeEntries(upserts)
      for (const id of deletes) sql.exec('DELETE FROM preference_entry_v2 WHERE bookmark_id = ?', id)
    })
  }

  replace(sums: PreferenceSums, entries: Map<number, PreferenceEntry>) {
    const sql = this.sql
    this.storage.transactionSync(() => {
      for (const table of LEGACY_TABLES) sql.exec(`DROP TABLE IF EXISTS ${table}`)
      sql.exec('DELETE FROM preference_entry_v2')
      this.writeState(sums)
      this.writeEntries(entries)
    })
  }

  async clear() {
    await this.storage.deleteAll()
    this.ready = false
  }
}
