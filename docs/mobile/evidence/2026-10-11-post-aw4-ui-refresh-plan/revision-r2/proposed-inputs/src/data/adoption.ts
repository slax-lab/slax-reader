import type {PreferenceStore} from './preferences.ts';
import type {AdoptionEvidence, DatabaseLocation, DatabaseLogicalIdentity, LegacyInventory} from './upgrade.ts';
import {verifiedDatabaseLocation} from './upgrade.ts';

export interface DatabaseSnapshot {
  databasePath: string; formatVersion: number; userVersion: number; integrityValid: boolean;
  storageTables: string[]; pendingOperations: number; pendingTransactions: number;
  queueDigest: string; dataDigest: string; localDigest: string;
}
export interface DatabaseInspector { inspectLegacyDatabase(path: string): Promise<DatabaseSnapshot> }
const JOURNAL = '_slax_database_adoption_v1';
const DATA_TABLES = ['sr_user', 'sr_user_tag', 'sr_platform_bind', 'sr_user_notification', 'sr_user_bookmark', 'sr_user_subscription', 'sr_user_collection_subscriber', 'sr_user_collection', 'sr_sharer_setting', 'sr_collection_bookmark', 'sr_user_bookmark_stats', 'sr_bookmark_comment'].map(table => `ps_data__${table}`).concat('ps_data_local__local_bookmark_info').sort();
interface Journal { path: string; phase: 'opening' | 'accepted' | 'failed'; before: DatabaseSnapshot; targetSdk: string; logicalIdentity?: DatabaseLogicalIdentity }
export class DatabaseAdoptionRejected extends Error {
  constructor(message: string) {super(message); this.name = 'DatabaseAdoptionRejected';}
}
export function validateDatabaseSnapshot(snapshot: DatabaseSnapshot, path: string) {
  if (!snapshot || snapshot.databasePath !== path || !snapshot.integrityValid || snapshot.formatVersion !== 14 || snapshot.userVersion !== 1 || !Array.isArray(snapshot.storageTables) || JSON.stringify([...snapshot.storageTables].sort()) !== JSON.stringify(DATA_TABLES)) throw new DatabaseAdoptionRejected('The existing database format is outside the verified migration profile');
  for (const value of [snapshot.pendingOperations, snapshot.pendingTransactions]) if (!Number.isSafeInteger(value) || value < 0) throw new DatabaseAdoptionRejected('The existing queue inventory is incomplete');
  if ((snapshot.pendingOperations === 0) !== (snapshot.pendingTransactions === 0) || snapshot.pendingTransactions > snapshot.pendingOperations) throw new DatabaseAdoptionRejected('The existing queue transaction inventory is inconsistent');
  for (const digest of [snapshot.queueDigest, snapshot.dataDigest, snapshot.localDigest]) if (!/^[a-f0-9]{64}$/.test(digest)) throw new DatabaseAdoptionRejected('The existing database inventory lacks complete checksums');
}
export function unchangedDatabaseData(before: DatabaseSnapshot, after: DatabaseSnapshot): boolean {
  return before.databasePath === after.databasePath && before.pendingOperations === after.pendingOperations && before.pendingTransactions === after.pendingTransactions && before.queueDigest === after.queueDigest && before.dataDigest === after.dataDigest && before.localDigest === after.localDigest;
}
const UUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';
function validLogicalIdentity(identity: DatabaseLogicalIdentity, path: string): boolean {
  if (!identity || typeof identity.owner !== 'string' || !identity.owner || typeof identity.relativePath !== 'string' || !identity.relativePath || identity.relativePath.startsWith('/') || identity.relativePath.includes('\0') || identity.relativePath.split('/').some(part => !part || part === '.' || part === '..')) return false;
  if (identity.relocationPrefix === undefined) return true;
  const prefix = identity.relocationPrefix;
  if (typeof prefix !== 'string' || prefix.includes('\0') || prefix.split('/').some(part => part === '.' || part === '..') || !new RegExp(`^(?:/.*/CoreSimulator/Devices/${UUID}/data/Containers/Data/Application/|/private/var/mobile/Containers/Data/Application/|/var/mobile/Containers/Data/Application/)$`).test(prefix)) return false;
  return path.startsWith(prefix) && new RegExp(`^${UUID}/`).test(path.slice(prefix.length)) && path.slice(prefix.length + 37) === identity.relativePath;
}
function sameLogicalIdentity(a: DatabaseLogicalIdentity, b: DatabaseLogicalIdentity): boolean {
  return a.owner === b.owner && a.relativePath === b.relativePath && a.relocationPrefix === b.relocationPrefix;
}
function priorSnapshotAtCurrentPath(previous: Journal, path: string, identity: DatabaseLogicalIdentity | undefined): DatabaseSnapshot {
  if (!previous.before || typeof previous.path !== 'string') throw new DatabaseAdoptionRejected('The existing migration checkpoint is incomplete');
  validateDatabaseSnapshot(previous.before, previous.path);
  if (previous.logicalIdentity && (!identity || !validLogicalIdentity(previous.logicalIdentity, previous.path) || !sameLogicalIdentity(previous.logicalIdentity, identity))) throw new DatabaseAdoptionRejected('A different logical database migration owns this installation');
  if (previous.path !== path && (!identity?.relocationPrefix || !validLogicalIdentity(identity, path) || !validLogicalIdentity(identity, previous.path))) throw new DatabaseAdoptionRejected('A different database migration owns this installation');
  return {...previous.before, databasePath: path};
}
/** Only the migration coordinator may open an existing file, while holding the native ownership lease. */
export async function openVerifiedDatabase<T extends {close(): Promise<unknown>}>(options: {
  inventory: LegacyInventory; evidence?: AdoptionEvidence; inspector: DatabaseInspector; preferences: PreferenceStore;
  open(location: DatabaseLocation): Promise<T>;
}): Promise<T> {
  const location = verifiedDatabaseLocation(options.inventory, options.evidence);
  if (!location.adopted) return options.open(location);
  const path = options.evidence!.databasePath;
  const before = await options.inspector.inspectLegacyDatabase(path);
  validateDatabaseSnapshot(before, path);
  const logicalIdentity = options.inventory.databaseIdentities?.[path];
  if (logicalIdentity && !validLogicalIdentity(logicalIdentity, path)) throw new DatabaseAdoptionRejected('The native logical database identity is incomplete');
  const stored = (await options.preferences.read())[JOURNAL];
  if (typeof stored === 'string') {
    let previous: Journal;
    try {previous = JSON.parse(stored) as Journal;} catch {throw new DatabaseAdoptionRejected('The existing migration checkpoint cannot be read; original data is retained');}
    if (previous.targetSdk !== options.evidence!.targetSdk) throw new DatabaseAdoptionRejected('A different database migration owns this installation');
    const prior = priorSnapshotAtCurrentPath(previous, path, logicalIdentity);
    if (previous.phase === 'failed') throw new DatabaseAdoptionRejected('The previous adoption failed verification; automatic rollback is blocked');
    if ((previous.phase === 'opening' || (previous.path !== path && !previous.logicalIdentity)) && !unchangedDatabaseData(prior, before)) throw new DatabaseAdoptionRejected('Interrupted or unscoped relocated adoption changed queued or offline data; automatic rollback is blocked');
    if (!['opening', 'accepted'].includes(previous.phase)) throw new DatabaseAdoptionRejected('Unknown migration checkpoint; original data is retained');
  }
  const journal: Journal = {path, phase: 'opening', before, targetSdk: options.evidence!.targetSdk, ...(logicalIdentity ? {logicalIdentity} : {})};
  await options.preferences.update(values => {values[JOURNAL] = JSON.stringify(journal);});
  let database: T | undefined;
  try {
    database = await options.open(location);
    const after = await options.inspector.inspectLegacyDatabase(path);
    validateDatabaseSnapshot(after, path);
    if (!unchangedDatabaseData(before, after)) {
      journal.phase = 'failed';
      await options.preferences.update(values => {values[JOURNAL] = JSON.stringify(journal);});
      throw new DatabaseAdoptionRejected('Database initialization changed pending or offline data; automatic rollback is blocked');
    }
    journal.phase = 'accepted';
    await options.preferences.update(values => {values[JOURNAL] = JSON.stringify(journal);});
    return database;
  } catch (error) {
    // Leave an opening checkpoint on interruption: retry is allowed only after a fresh unchanged snapshot.
    if (database) await database.close();
    throw error;
  }
}
