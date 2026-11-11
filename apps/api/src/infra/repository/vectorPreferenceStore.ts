import {
  packSum,
  parseInterests,
  unpackSum,
  validCounts,
  vectorToken,
  type MemberGroup,
  type PreferenceCounts,
  type PreferenceEntry,
  type PreferenceStore,
  type PreferenceSums,
  type ShareGroup
} from '@/utils/preferenceLedger'

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS preference_state_v3 (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, mean_version TEXT NOT NULL, raw BLOB NOT NULL, centered BLOB NOT NULL, shared BLOB NOT NULL, inherited BLOB NOT NULL, counts TEXT NOT NULL, interests TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS preference_entry_v3 (bookmark_id INTEGER PRIMARY KEY, weight INTEGER NOT NULL, share_group INTEGER NOT NULL, token TEXT NOT NULL, contribution BLOB NOT NULL, published_at REAL NOT NULL, actions TEXT NOT NULL, acted_at REAL NOT NULL)',
  "CREATE INDEX IF NOT EXISTS preference_entry_v3_publication ON preference_entry_v3 (share_group, published_at DESC) WHERE token <> ''",
  "CREATE INDEX IF NOT EXISTS preference_entry_v3_recent ON preference_entry_v3 (acted_at DESC, bookmark_id DESC) WHERE token <> ''"
]
const LEGACY_TABLES = ['preference_state', 'preference_entry', 'preference_state_v2', 'preference_entry_v2']
const BIND_LIMIT = 90
const GROUPS: ShareGroup[] = ['none', 'shared', 'inherited']
type StateRow = { seq: number; mean_version: string; raw: ArrayBuffer; centered: ArrayBuffer; shared: ArrayBuffer; inherited: ArrayBuffer; counts: string; interests: string }
type EntryRow = { bookmark_id: number; weight: number; share_group: number; token: string; contribution: ArrayBuffer; published_at: number; actions: string }
const blob = (sum: Float64Array): ArrayBuffer => packSum(sum).slice().buffer
const COLUMNS = 'bookmark_id, weight, share_group, token, contribution, published_at, actions'

function entry(row: EntryRow): PreferenceEntry {
  const group = GROUPS[row.share_group]
  if (!Number.isSafeInteger(row.weight) || row.weight < 1 || !group || (row.token && !/^[0-9a-f]{16}$/.test(row.token))) throw new Error('invalid_preference_state')
  const values = row.token ? Array.from(unpackSum(new Uint8Array(row.contribution))) : undefined
  if (values && vectorToken(values) !== row.token) throw new Error('invalid_preference_state')
  const actions: number[] = JSON.parse(row.actions)
  if (!Array.isArray(actions) || actions.length > 2 || actions.some(value => !Number.isFinite(value)) || !Number.isFinite(row.published_at))
    throw new Error('invalid_preference_state')
  return { weight: row.weight, group, token: row.token, values, publishedAt: row.published_at, actions }
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
    if (
      this.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('preference_state','preference_entry','preference_state_v2','preference_entry_v2') LIMIT 1")
        .toArray().length
    )
      return null
    const rows = this.sql.exec<StateRow>('SELECT seq, mean_version, raw, centered, shared, inherited, counts, interests FROM preference_state_v3 WHERE id = 1').toArray()
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
      for (const row of this.sql.exec<EntryRow>(`SELECT ${COLUMNS} FROM preference_entry_v3 WHERE bookmark_id IN (${page.map(() => '?').join(',')})`, ...page))
        found.set(row.bookmark_id, entry(row))
    }
    return found
  }

  latestPublication(groups: MemberGroup[]): number {
    let latest = 0
    for (const group of groups) {
      const rows = this.sql
        .exec<{
          published_at: number
        }>("SELECT published_at FROM preference_entry_v3 WHERE token <> '' AND share_group = ? ORDER BY published_at DESC LIMIT 1", GROUPS.indexOf(group))
        .toArray()
      if (rows.length) latest = Math.max(latest, rows[0].published_at)
    }
    return latest
  }

  recentEntries(since: number, limit: number): Map<number, PreferenceEntry> {
    const rows = this.sql.exec<EntryRow>(
      `SELECT ${COLUMNS} FROM preference_entry_v3 WHERE token <> '' AND acted_at >= ? ORDER BY acted_at DESC, bookmark_id DESC LIMIT ?`,
      since,
      limit
    )
    return new Map([...rows].map(row => [row.bookmark_id, entry(row)]))
  }

  private writeState(sums: PreferenceSums) {
    this.sql.exec(
      'INSERT INTO preference_state_v3 (id, seq, mean_version, raw, centered, shared, inherited, counts, interests) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET seq = excluded.seq, mean_version = excluded.mean_version, raw = excluded.raw, centered = excluded.centered, shared = excluded.shared, inherited = excluded.inherited, counts = excluded.counts, interests = excluded.interests',
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
    for (const [id, value] of entries) {
      if (value.token && !value.values) throw new Error('invalid_preference_state')
      const actions = value.actions || []
      this.sql.exec(
        'INSERT INTO preference_entry_v3 (bookmark_id, weight, share_group, token, contribution, published_at, actions, acted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (bookmark_id) DO UPDATE SET weight = excluded.weight, share_group = excluded.share_group, token = excluded.token, contribution = excluded.contribution, published_at = excluded.published_at, actions = excluded.actions, acted_at = excluded.acted_at',
        id,
        value.weight,
        GROUPS.indexOf(value.group),
        value.token,
        value.values ? blob(Float64Array.from(value.values)) : new ArrayBuffer(0),
        value.publishedAt || 0,
        JSON.stringify(actions),
        Math.max(0, ...actions)
      )
    }
  }

  commit(sums: PreferenceSums, upserts: Map<number, PreferenceEntry>, deletes: number[]) {
    const sql = this.sql
    this.storage.transactionSync(() => {
      this.writeState(sums)
      this.writeEntries(upserts)
      for (const id of deletes) sql.exec('DELETE FROM preference_entry_v3 WHERE bookmark_id = ?', id)
    })
  }

  replace(sums: PreferenceSums, entries: Map<number, PreferenceEntry>) {
    const sql = this.sql
    this.storage.transactionSync(() => {
      for (const table of LEGACY_TABLES) sql.exec(`DROP TABLE IF EXISTS ${table}`)
      sql.exec('DELETE FROM preference_entry_v3')
      this.writeState(sums)
      this.writeEntries(entries)
    })
  }

  beginInitialization() {
    const sql = this.sql
    this.storage.transactionSync(() => {
      sql.exec('DELETE FROM preference_state_v3')
      sql.exec('DELETE FROM preference_entry_v3')
    })
  }

  appendInitialization(entries: Map<number, PreferenceEntry>) {
    this.storage.transactionSync(() => this.writeEntries(entries))
  }

  finishInitialization(sums: PreferenceSums) {
    const sql = this.sql
    this.storage.transactionSync(() => {
      for (const table of LEGACY_TABLES) sql.exec(`DROP TABLE IF EXISTS ${table}`)
      this.writeState(sums)
    })
  }

  async clear() {
    await this.storage.deleteAll()
    this.ready = false
  }
}
