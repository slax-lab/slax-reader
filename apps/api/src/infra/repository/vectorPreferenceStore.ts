import { packSum, parseInterests, unpackSum, type PreferenceEntry, type PreferenceStore, type PreferenceSums, type PreferenceSummary } from '@/utils/preferenceLedger'

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS preference_state (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, mean_version TEXT NOT NULL, raw BLOB NOT NULL, centered BLOB NOT NULL, owner BLOB NOT NULL, interests TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS preference_entry (bookmark_id INTEGER PRIMARY KEY, weight INTEGER NOT NULL, member INTEGER NOT NULL, token TEXT NOT NULL)'
]
const BIND_LIMIT = 90

type StateRow = { seq: number; mean_version: string; raw: ArrayBuffer; centered: ArrayBuffer; owner: ArrayBuffer; interests: string }
type EntryRow = { bookmark_id: number; weight: number; member: number; token: string }

const blob = (sum: Float64Array): ArrayBuffer => packSum(sum).slice().buffer

function entry(row: EntryRow): PreferenceEntry {
  if (!Number.isSafeInteger(row.weight) || row.weight < 1 || (row.member !== 0 && row.member !== 1) || (row.token && !/^[0-9a-f]{16}$/.test(row.token)))
    throw new Error('invalid_preference_state')
  return { weight: row.weight, member: row.member === 1, token: row.token }
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
    const rows = this.sql.exec<StateRow>('SELECT seq, mean_version, raw, centered, owner, interests FROM preference_state WHERE id = 1').toArray()
    if (!rows.length) return null
    const row = rows[0]
    if (!Number.isSafeInteger(row.seq) || row.seq < 1) throw new Error('invalid_preference_state')
    return {
      seq: row.seq,
      meanVersion: row.mean_version,
      raw: unpackSum(new Uint8Array(row.raw)),
      centered: unpackSum(new Uint8Array(row.centered)),
      owner: unpackSum(new Uint8Array(row.owner)),
      interests: parseInterests(row.interests)
    }
  }

  entries(ids: number[]): Map<number, PreferenceEntry> {
    const found = new Map<number, PreferenceEntry>()
    for (let offset = 0; offset < ids.length; offset += BIND_LIMIT) {
      const page = ids.slice(offset, offset + BIND_LIMIT)
      const cursor = this.sql.exec<EntryRow>(`SELECT bookmark_id, weight, member, token FROM preference_entry WHERE bookmark_id IN (${page.map(() => '?').join(',')})`, ...page)
      for (const row of cursor) found.set(row.bookmark_id, entry(row))
    }
    return found
  }

  summary(): PreferenceSummary {
    const row = this.sql
      .exec<{
        eligible: number
        used: number | null
        members: number | null
        missing: number | null
      }>(
        "SELECT COUNT(*) AS eligible, SUM(token <> '') AS used, SUM(member) AS members, MIN(CASE WHEN member = 1 AND token = '' THEN bookmark_id END) AS missing FROM preference_entry"
      )
      .one()
    return { eligible: row.eligible, used: row.used ?? 0, members: row.members ?? 0, firstMissingMember: row.missing ?? undefined }
  }

  private writeState(sums: PreferenceSums) {
    this.sql.exec(
      'INSERT INTO preference_state (id, seq, mean_version, raw, centered, owner, interests) VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET seq = excluded.seq, mean_version = excluded.mean_version, raw = excluded.raw, centered = excluded.centered, owner = excluded.owner, interests = excluded.interests',
      sums.seq,
      sums.meanVersion,
      blob(sums.raw),
      blob(sums.centered),
      blob(sums.owner),
      JSON.stringify(sums.interests)
    )
  }

  private writeEntries(entries: Map<number, PreferenceEntry>) {
    for (const [id, value] of entries)
      this.sql.exec(
        'INSERT INTO preference_entry (bookmark_id, weight, member, token) VALUES (?, ?, ?, ?) ON CONFLICT (bookmark_id) DO UPDATE SET weight = excluded.weight, member = excluded.member, token = excluded.token',
        id,
        value.weight,
        value.member ? 1 : 0,
        value.token
      )
  }

  commit(sums: PreferenceSums, upserts: Map<number, PreferenceEntry>, deletes: number[]) {
    const sql = this.sql
    this.storage.transactionSync(() => {
      this.writeState(sums)
      this.writeEntries(upserts)
      for (const id of deletes) sql.exec('DELETE FROM preference_entry WHERE bookmark_id = ?', id)
    })
  }

  replace(sums: PreferenceSums, entries: Map<number, PreferenceEntry>) {
    const sql = this.sql
    this.storage.transactionSync(() => {
      sql.exec('DELETE FROM preference_entry')
      this.writeState(sums)
      this.writeEntries(entries)
    })
  }

  async clear() {
    await this.storage.deleteAll()
    this.ready = false
  }
}
