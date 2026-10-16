import {UpgradeVerificationRequired} from './upgrade.ts';
import type {AdoptionEvidence, LegacyInventory} from './upgrade.ts';

/** Historical on-disk evidence; reviewedSource retains the old bridge, not proof of the current lifecycle. */
export const REVIEWED_ADOPTION_PROFILE = Object.freeze({
  id: 'slax-powersync-format14-schema2-v1',
  legacySdk: 'powersync-kotlin-1.14.1', legacyCore: '0.5.1',
  targetSdk: 'powersync-react-native-2.3.1', targetCore: '0.5.3/2ba6b280',
  sqliteDriver: 'op-sqlite-18.2.5', schemaVersion: '2', formatVersion: 14, userVersion: 1,
  nativeSourceSHA256: Object.freeze({
    android: '487b780bb58831a2ec2e0452d7077961002764c09a45dbe06f0aa067c8040ef5',
    ios: 'e5f9ba9b9876201567a2aac59d3d2cc8b3189d43b1140b11fdb980a6c2579ae3',
  }),
  nativeCompatibilitySources: Object.freeze([
    Object.freeze({platform: 'android', path: 'modules/slax-legacy/android/src/main/java/com/slax/reader/legacy/SlaxLegacyModule.kt', reviewedSource: 'tests/data/adoption-fixtures/reviewed-native/SlaxLegacyModule.kt', sha256: '487b780bb58831a2ec2e0452d7077961002764c09a45dbe06f0aa067c8040ef5'}),
    Object.freeze({platform: 'ios', path: 'modules/slax-legacy/ios/SlaxLegacyModule.swift', reviewedSource: 'tests/data/adoption-fixtures/reviewed-native/SlaxLegacyModule.swift', sha256: 'e5f9ba9b9876201567a2aac59d3d2cc8b3189d43b1140b11fdb980a6c2579ae3'}),
    Object.freeze({platform: 'ios', path: 'modules/slax-legacy/ios/DatabaseIdentity.swift', sha256: 'f8f020698a160425d5be842d276f23b0294291a8ab96e07c4db185289aba806a'}),
    Object.freeze({platform: 'ios', path: 'modules/slax-legacy/ios/DatabaseInspection.swift', reviewedSource: 'tests/data/adoption-fixtures/reviewed-native/DatabaseInspection.swift', sha256: '8dcd9b4ff0d188cb70a1c4f347848a61fc98b5b94b1463723a717db82b10ff02'}),
  ]),
  evidence: Object.freeze([
    Object.freeze({report: 'ios-original-queue-real-service.json', sha256: 'daea6445855b441a4be37ad3d7fd695614f5d86c3236a3aa79059d4a8c43ab71'}),
    Object.freeze({report: 'android-original-queue-real-service.json', sha256: '5ada6e8518df019fb02e9f638cea271cfd54cd36aa885c7bfe734976ac57949a'}),
    Object.freeze({report: 'ios-first-upgrade-and-reinstall.json', sha256: '9e47ca4673ae3e55570b7baef93d86a494ea381b0fb493c7f7e25eb85b122fdf'}),
    Object.freeze({report: 'android-original-service-repeat-install.json', sha256: '8bfe82565e015c45ee29707daeebf48c0626b49e5c7d677a11132cad5b4313d7'}),
  ]),
} as const);

const UUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';
const canonicalShape = (value: string) => typeof value === 'string' && value.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(value) && !value.includes('\\') && value.split('/').slice(1).every(part => part !== '' && part !== '.' && part !== '..');

/**
 * Call only with the inventory returned by the held native ownership lease.
 * First/interrupted adoption inspects full data; accepted, matching checkpoints verify the schema.
 * No fixture marker, report file or device-specific path is trusted at runtime.
 */
export function deriveReviewedAdoptionEvidence(inventory: LegacyInventory, platform: string): AdoptionEvidence | undefined {
  const reject = (): never => {throw new UpgradeVerificationRequired(inventory);};
  if (!inventory.scanComplete || !canonicalShape(inventory.newDatabaseDirectory) || !canonicalShape(inventory.legacyDataDirectory)) reject();
  if (!inventory.databaseCandidates.length) return undefined;
  if (inventory.databaseCandidates.length !== 1 || !['android', 'ios'].includes(platform)) reject();
  const databasePath = inventory.databaseCandidates[0]!;
  const identity = inventory.databaseIdentities?.[databasePath];
  if (!canonicalShape(databasePath) || !identity || typeof identity.owner !== 'string' || typeof identity.relativePath !== 'string') throw new UpgradeVerificationRequired(inventory);
  if (platform === 'android') {
    const root = inventory.legacyDataDirectory;
    if (!/^\/data\/(?:data|user\/(?:0|[1-9][0-9]*))\/com\.slax\.reader$/.test(root) || databasePath !== `${root}/databases/powersync.db` || identity.relativePath !== 'databases/powersync.db' || identity.owner !== `android:com.slax.reader:${root}/files` || identity.relocationPrefix !== undefined) reject();
  } else {
    const support = inventory.legacyDataDirectory;
    const simulator = support.match(new RegExp(`^(\/(?:[^/]+\/)*CoreSimulator\/Devices\/${UUID}\/data\/Containers\/)Data\/Application\/${UUID}\/Library\/Application Support$`));
    const device = support.match(new RegExp(`^(\/(?:private\/)?var\/mobile\/Containers\/)Data\/Application\/${UUID}\/Library\/Application Support$`));
    const containers = (simulator ?? device)?.[1];
    if (!containers || identity.relativePath !== 'Library/Application Support/databases/powersync.db' || identity.relocationPrefix !== `${containers}Data/Application/` || databasePath !== `${support}/databases/powersync.db`) reject();
    const group = identity.owner.slice('ios:app.slax.reader:'.length);
    if (!identity.owner.startsWith('ios:app.slax.reader:') || !canonicalShape(group) || !group.startsWith(`${containers}Shared/AppGroup/`) || !new RegExp(`^${UUID}$`).test(group.slice(`${containers}Shared/AppGroup/`.length))) reject();
  }
  return {
    databasePath,
    legacySdk: REVIEWED_ADOPTION_PROFILE.legacySdk, targetSdk: REVIEWED_ADOPTION_PROFILE.targetSdk,
    schemaVersion: REVIEWED_ADOPTION_PROFILE.schemaVersion, supportedOnDiskAdoption: true,
    verifiedFixtures: {pendingQueue: true, transactionBoundaries: true, offlineRows: true, localJson: true, reconnectOrder: true},
    report: REVIEWED_ADOPTION_PROFILE.id,
  };
}
