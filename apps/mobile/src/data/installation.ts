import type {DatabaseLocation, DatabaseLogicalIdentity, LegacyInventory} from './upgrade.ts';

export const INSTALLATION_KEY = '_slax_database_installation_v1';
export const DATABASE_TARGET_SDK = 'powersync-react-native-2.3.1';
export const DATABASE_SCHEMA_VERSION = '2';
export const DATABASE_STORAGE_TABLES = ['sr_user', 'sr_user_tag', 'sr_platform_bind', 'sr_user_notification', 'sr_user_bookmark', 'sr_user_subscription', 'sr_user_collection_subscriber', 'sr_user_collection', 'sr_sharer_setting', 'sr_collection_bookmark', 'sr_user_bookmark_stats', 'sr_bookmark_comment'].map(table => `ps_data__${table}`).concat('ps_data_local__local_bookmark_info').sort();

export interface DatabaseSchemaSnapshot {
  databasePath: string;
  formatVersion: number;
  userVersion: number;
  storageTables: string[];
}
export interface InstallationBinding {
  version: 1;
  state: 'ready';
  mode: 'native' | 'adopted';
  path: string;
  identity: DatabaseLogicalIdentity;
  targetSdk: string;
  schemaVersion: string;
  profile: string;
}
export class DatabaseInitializationError extends Error {
  constructor(message: string) {super(message); this.name = 'DatabaseInitializationError';}
}

const UUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';
const safePath = (value: unknown): value is string => typeof value === 'string' && value.startsWith('/') && !/[\u0000-\u001f\u007f\\]/.test(value) && value.split('/').slice(1).every(part => part !== '' && part !== '.' && part !== '..');

export function validDatabaseIdentity(identity: DatabaseLogicalIdentity, path: string): boolean {
  if (!identity || !safePath(path) || typeof identity.owner !== 'string' || !identity.owner || /[\u0000-\u001f\u007f]/.test(identity.owner) || typeof identity.relativePath !== 'string' || !identity.relativePath || identity.relativePath.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(identity.relativePath) || identity.relativePath.split('/').some(part => !part || part === '.' || part === '..')) return false;
  if (identity.relocationPrefix === undefined) return path.endsWith(`/${identity.relativePath}`);
  const prefix = identity.relocationPrefix;
  if (typeof prefix !== 'string' || !safePath(prefix.slice(0, -1)) || !new RegExp(`^(?:/.*/CoreSimulator/Devices/${UUID}/data/Containers/Data/Application/|/private/var/mobile/Containers/Data/Application/|/var/mobile/Containers/Data/Application/)$`).test(prefix)) return false;
  return path.startsWith(prefix) && new RegExp(`^${UUID}/`).test(path.slice(prefix.length)) && path.slice(prefix.length + 37) === identity.relativePath;
}

export function sameDatabaseIdentity(left: DatabaseLogicalIdentity, right: DatabaseLogicalIdentity): boolean {
  return left.owner === right.owner && left.relativePath === right.relativePath && left.relocationPrefix === right.relocationPrefix;
}

export function validateDatabaseSchema(snapshot: DatabaseSchemaSnapshot, path: string): void {
  if (!snapshot || snapshot.databasePath !== path || snapshot.formatVersion !== 14 || snapshot.userVersion !== 1 || !Array.isArray(snapshot.storageTables) || JSON.stringify([...snapshot.storageTables].sort()) !== JSON.stringify(DATABASE_STORAGE_TABLES)) throw new DatabaseInitializationError('The established database schema requires recovery');
}

export function readInstallationBinding(value: unknown): InstallationBinding | null {
  if (value === undefined) return null;
  let binding: InstallationBinding;
  try {binding = JSON.parse(typeof value === 'string' ? value : '') as InstallationBinding;} catch {throw new DatabaseInitializationError('The database initialization record cannot be read');}
  if (!binding || binding.version !== 1 || binding.state !== 'ready' || !['native', 'adopted'].includes(binding.mode) || !validDatabaseIdentity(binding.identity, binding.path) || binding.targetSdk !== DATABASE_TARGET_SDK || binding.schemaVersion !== DATABASE_SCHEMA_VERSION || typeof binding.profile !== 'string' || !binding.profile) throw new DatabaseInitializationError('The database initialization record requires recovery');
  return binding;
}

export function initializedDatabaseLocation(binding: InstallationBinding, inventory: LegacyInventory): DatabaseLocation {
  const initialized = inventory.initializedDatabase;
  const identity = initialized && inventory.databaseIdentities?.[initialized.path];
  if (!inventory.scanComplete || !initialized || initialized.mode !== binding.mode || !identity || !validDatabaseIdentity(identity, initialized.path) || !sameDatabaseIdentity(binding.identity, identity) || binding.path !== initialized.path && !identity.relocationPrefix) throw new DatabaseInitializationError('The established database identity requires recovery');
  const expected = binding.mode === 'native' ? `${inventory.newDatabaseDirectory}/powersync.db` : inventory.databaseCandidates.length === 1 ? inventory.databaseCandidates[0] : null;
  if (initialized.path !== expected || binding.mode === 'native' && inventory.databaseCandidates.length !== 0) throw new DatabaseInitializationError('The established database location requires recovery');
  const slash = initialized.path.lastIndexOf('/');
  return {dbFilename: initialized.path.slice(slash + 1), dbLocation: initialized.path.slice(0, slash), adopted: binding.mode === 'adopted'};
}

export function createInstallationBinding(location: DatabaseLocation, inventory: LegacyInventory, profile: string): InstallationBinding | null {
  const path = `${location.dbLocation}/${location.dbFilename}`;
  const identity = inventory.databaseIdentities?.[path];
  if (!identity) return null;
  if (!validDatabaseIdentity(identity, path)) throw new DatabaseInitializationError('The initialized database identity is invalid');
  return {version: 1, state: 'ready', mode: location.adopted ? 'adopted' : 'native', path, identity, targetSdk: DATABASE_TARGET_SDK, schemaVersion: DATABASE_SCHEMA_VERSION, profile};
}
