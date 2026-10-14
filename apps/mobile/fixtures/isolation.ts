import type {PreferenceSnapshot, PreferenceStorage, PreferenceValues} from '../src/data/preferences.ts';
import type {TableDefinition} from '../src/data/schema.ts';
import type {FixtureRoute} from './transport.ts';

const copy = (values: PreferenceValues) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
export class FixtureMemoryPreferences implements PreferenceStorage {
  private revision = 0;
  private values: PreferenceValues;
  constructor(values: PreferenceValues) {this.values = copy(values);}
  async read(): Promise<PreferenceSnapshot> {return {revision: this.revision, values: copy(this.values)};}
  async compareAndSwap(revision: number, values: PreferenceValues): Promise<boolean> {if (revision !== this.revision) return false; this.values = copy(values); this.revision++; return true;}
}
export interface FixtureMarker {controlledFixture: true; fixtureVersion: 1; scenario?: string; inputSha256?: string}
export function assertFixtureScope(scopeUri: string, cacheUri: string, marker: unknown): asserts marker is FixtureMarker {
  const scope = new URL(scopeUri), cache = new URL(cacheUri), prefix = cache.pathname.replace(/\/$/, '') + '/slax-ui-fixtures/';
  if (scope.protocol !== 'file:' || cache.protocol !== 'file:' || scope.host || cache.host || !scope.pathname.startsWith(prefix) || !/^[a-z0-9-]+\/?$/.test(scope.pathname.slice(prefix.length))) throw new Error('Fixture directory must be one isolated child of cache/slax-ui-fixtures');
  if (!marker || typeof marker !== 'object' || (marker as FixtureMarker).controlledFixture !== true || (marker as FixtureMarker).fixtureVersion !== 1) throw new Error('Controlled fixture marker is missing');
}
export function planFixtureRows(definitions: Record<string, TableDefinition>, rows: Record<string, Record<string, unknown>[]>): {sql: string; parameters: unknown[]}[] {
  const plans: {sql: string; parameters: unknown[]}[] = [];
  for (const [table, records] of Object.entries(rows)) {
    if (table === 'ps_data_local__local_bookmark_info') {
      for (const row of records) {
        if (typeof row.id !== 'string' || typeof row.data !== 'string' || !JSON.parse(row.data) || typeof JSON.parse(row.data) !== 'object') throw new Error('Invalid fixture local row');
        plans.push({sql: `INSERT INTO ${table} (id, data) VALUES (?, ?)`, parameters: [row.id, row.data]});
      }
      continue;
    }
    const definition = definitions[table];
    if (!definition || !/^[a-z_]+$/.test(table)) throw new Error('Fixture rows cannot address an unknown table');
    const allowed = ['id', ...definition.text, ...(definition.integer ?? [])];
    for (const row of records) {
      if (typeof row.id !== 'string' || !row.id) throw new Error('Fixture rows require a synthetic identifier');
      const columns = allowed.filter(column => Object.hasOwn(row, column));
      plans.push({sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, parameters: columns.map(column => row[column])});
    }
  }
  return plans;
}
export function decodeFixtureArtwork(base64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', output: number[] = [];
  let accumulator = 0, bits = 0;
  for (const char of base64) {
    if (char === '=') break;
    const value = alphabet.indexOf(char); if (value < 0) throw new Error('Invalid fixture artwork');
    accumulator = (accumulator << 6) | value; bits += 6;
    if (bits >= 8) {bits -= 8; output.push((accumulator >> bits) & 255);}
  }
  return new Uint8Array(output);
}

/** Match the production RSS reader's per-entry cache key, including history/detail routes. */
export function preparedRssCacheKeys(routes: FixtureRoute[]): string[] {
  const keys = new Set(['rss-fixture']);
  for (const route of routes) {
    if (route.method !== 'GET' || route.status !== 200 || !/^\/v1\/rss\/entries(?:\/[^/]+)?$/.test(route.path)) continue;
    const data = (route.json as {data?: {items?: unknown[]; id?: unknown}} | undefined)?.data;
    for (const record of data?.items ?? (data ? [data] : [])) {
      const id = (record as {id?: unknown}).id;
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Prepared RSS artwork needs a safe synthetic entry identifier');
      keys.add(`rss-${id}`);
    }
  }
  return [...keys];
}
