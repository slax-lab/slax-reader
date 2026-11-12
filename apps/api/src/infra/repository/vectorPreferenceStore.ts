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

const GROUPS: ShareGroup[] = ['none', 'shared', 'inherited']
const ENTRY_PAGE = 1000
type Blob = ArrayBuffer | ArrayLike<number> | null
type StateRow = { seq: number; mean_version: string; raw: Blob; centered: Blob; shared: Blob; inherited: Blob; counts: string; interests: string }
type EntryRow = { bookmark_id: number; weight: number; share_group: number; token: string; published_at: number }

const bytes = (value: Blob) => (value ? Uint8Array.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value) : new Uint8Array())
const blob = (sum: Float64Array): ArrayBuffer => packSum(sum).slice().buffer

function entry(row: EntryRow): PreferenceEntry {
  const group = GROUPS[row.share_group]
  if (!Number.isSafeInteger(row.weight) || row.weight < 1 || !group || (row.token && !/^[0-9a-f]{16}$/.test(row.token)) || !Number.isFinite(row.published_at))
    throw new Error('invalid_preference_state')
  return { weight: row.weight, group, token: row.token, publishedAt: row.published_at }
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

export class D1PreferenceStore implements PreferenceStore {
  constructor(
    private readonly db: D1Database,
    private readonly userId: number
  ) {}

  async read(): Promise<PreferenceSums | null> {
    const row = await this.db
      .prepare('SELECT seq, mean_version, raw, centered, shared, inherited, counts, interests FROM slax_vector_preference_state WHERE user_id = ?')
      .bind(this.userId)
      .first<StateRow>()
    if (!row) return null
    if (!Number.isSafeInteger(row.seq) || row.seq < 1) throw new Error('invalid_preference_state')
    return {
      seq: row.seq,
      meanVersion: row.mean_version,
      raw: unpackSum(bytes(row.raw)),
      centered: unpackSum(bytes(row.centered)),
      shared: unpackSum(bytes(row.shared)),
      inherited: unpackSum(bytes(row.inherited)),
      counts: counts(row.counts),
      interests: parseInterests(row.interests)
    }
  }

  async entries(ids: number[]): Promise<Map<number, PreferenceEntry>> {
    const found = new Map<number, PreferenceEntry>()
    for (let offset = 0; offset < ids.length; offset += ENTRY_PAGE) {
      const { results } = await this.db
        .prepare(
          'SELECT bookmark_id, weight, share_group, token, published_at FROM slax_vector_preference_entry WHERE user_id = ? AND bookmark_id IN (SELECT value FROM json_each(?))'
        )
        .bind(this.userId, JSON.stringify(ids.slice(offset, offset + ENTRY_PAGE)))
        .all<EntryRow>()
      for (const row of results) found.set(row.bookmark_id, entry(row))
    }
    return found
  }

  async latestPublication(groups: MemberGroup[]): Promise<number> {
    let latest = 0
    for (const group of groups) {
      const row = await this.db
        .prepare("SELECT published_at FROM slax_vector_preference_entry WHERE user_id = ? AND share_group = ? AND token <> '' ORDER BY published_at DESC LIMIT 1")
        .bind(this.userId, GROUPS.indexOf(group))
        .first<{ published_at: number }>()
      if (row) latest = Math.max(latest, row.published_at)
    }
    return latest
  }

  private writeState(sums: PreferenceSums): D1PreparedStatement {
    return this.db
      .prepare(
        'INSERT INTO slax_vector_preference_state (user_id, seq, mean_version, raw, centered, shared, inherited, counts, interests) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET seq = excluded.seq, mean_version = excluded.mean_version, raw = excluded.raw, centered = excluded.centered, shared = excluded.shared, inherited = excluded.inherited, counts = excluded.counts, interests = excluded.interests'
      )
      .bind(
        this.userId,
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

  private writeEntries(entries: Map<number, PreferenceEntry>): D1PreparedStatement[] {
    const rows = [...entries].map(([id, value]) => [id, value.weight, GROUPS.indexOf(value.group), value.token, value.publishedAt || 0])
    const statements: D1PreparedStatement[] = []
    for (let offset = 0; offset < rows.length; offset += ENTRY_PAGE)
      statements.push(
        this.db
          .prepare(
            "INSERT INTO slax_vector_preference_entry (user_id, bookmark_id, weight, share_group, token, published_at) SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'), json_extract(value, '$[4]') FROM json_each(?) WHERE true ON CONFLICT (user_id, bookmark_id) DO UPDATE SET weight = excluded.weight, share_group = excluded.share_group, token = excluded.token, published_at = excluded.published_at"
          )
          .bind(this.userId, JSON.stringify(rows.slice(offset, offset + ENTRY_PAGE)))
      )
    return statements
  }

  private deleteAll(): D1PreparedStatement[] {
    return [
      this.db.prepare('DELETE FROM slax_vector_preference_state WHERE user_id = ?').bind(this.userId),
      this.db.prepare('DELETE FROM slax_vector_preference_entry WHERE user_id = ?').bind(this.userId)
    ]
  }

  async commit(sums: PreferenceSums, upserts: Map<number, PreferenceEntry>, deletes: number[]) {
    const statements = [this.writeState(sums), ...this.writeEntries(upserts)]
    for (let offset = 0; offset < deletes.length; offset += ENTRY_PAGE)
      statements.push(
        this.db
          .prepare('DELETE FROM slax_vector_preference_entry WHERE user_id = ? AND bookmark_id IN (SELECT value FROM json_each(?))')
          .bind(this.userId, JSON.stringify(deletes.slice(offset, offset + ENTRY_PAGE)))
      )
    await this.db.batch(statements)
  }

  async beginInitialization() {
    await this.db.batch(this.deleteAll())
  }

  async appendInitialization(entries: Map<number, PreferenceEntry>) {
    const statements = this.writeEntries(entries)
    if (statements.length) await this.db.batch(statements)
  }

  async finishInitialization(sums: PreferenceSums) {
    await this.db.batch([this.writeState(sums)])
  }

  async clear() {
    await this.db.batch(this.deleteAll())
  }
}

export class VectorPreferenceStores {
  constructor(private readonly env: Env) {}

  forUser(userId: number): PreferenceStore {
    return new D1PreferenceStore(this.env.DB, userId)
  }
}
