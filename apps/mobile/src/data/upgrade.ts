export interface LegacyInventory {
  scanComplete: boolean; databaseCandidates: string[]; legacyDataDirectory: string; newDatabaseDirectory: string;
  /** Native canonical lock owner and database slot; only iOS application containers may relocate. */
  databaseIdentities?: Record<string, DatabaseLogicalIdentity>;
  initializedDatabase?: {path: string; mode: 'native' | 'adopted'};
}
export interface DatabaseLogicalIdentity { owner: string; relativePath: string; relocationPrefix?: string }
export interface DatabaseOwnership {
  /** Acquires the exclusive SDK owner; iOS private-container ownership is process-local. */
  beginDataOwnership(): Promise<LegacyInventory>;
  /** Development-only fast path: owns the current database slot without scanning or adopting legacy files. */
  beginFreshDataOwnership?(): Promise<LegacyInventory>;
  endDataOwnership(): Promise<void>;
}
export interface AdoptionEvidence {
  databasePath: string;
  legacySdk: 'powersync-kotlin-1.14.1'; targetSdk: 'powersync-react-native-2.3.1';
  schemaVersion: '2'; supportedOnDiskAdoption: true;
  verifiedFixtures: {pendingQueue: true; transactionBoundaries: true; offlineRows: true; localJson: true; reconnectOrder: true};
  report: string;
}
export class UpgradeVerificationRequired extends Error {
  readonly inventory: LegacyInventory;
  constructor(inventory: LegacyInventory) { super('The existing offline database requires verified adoption before it can be opened'); this.name = 'UpgradeVerificationRequired'; this.inventory = inventory; }
}
export interface DatabaseLocation { dbFilename: string; dbLocation: string; adopted: boolean }
/** No filename-only adoption, queue recreation, or new-empty-database escape hatch. */
export function verifiedDatabaseLocation(inventory: LegacyInventory, evidence?: AdoptionEvidence): DatabaseLocation {
  if (!inventory.scanComplete || !inventory.newDatabaseDirectory) throw new UpgradeVerificationRequired(inventory);
  if (!inventory.databaseCandidates.length) return {dbFilename: 'powersync.db', dbLocation: inventory.newDatabaseDirectory, adopted: false};
  const fixtures = evidence?.verifiedFixtures;
  if (inventory.databaseCandidates.length !== 1 || !evidence || inventory.databaseCandidates[0] !== evidence.databasePath || evidence.legacySdk !== 'powersync-kotlin-1.14.1' || evidence.targetSdk !== 'powersync-react-native-2.3.1' || evidence.schemaVersion !== '2' || !evidence.supportedOnDiskAdoption || !evidence.report || !fixtures?.pendingQueue || !fixtures.transactionBoundaries || !fixtures.offlineRows || !fixtures.localJson || !fixtures.reconnectOrder) throw new UpgradeVerificationRequired(inventory);
  const slash = evidence.databasePath.lastIndexOf('/');
  if (slash <= 0) throw new UpgradeVerificationRequired(inventory);
  return {dbFilename: evidence.databasePath.slice(slash + 1), dbLocation: evidence.databasePath.slice(0, slash), adopted: true};
}
