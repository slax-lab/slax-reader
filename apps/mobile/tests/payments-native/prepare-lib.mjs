import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, readdirSync, readFileSync, realpathSync} from 'node:fs';
import path from 'node:path';

export const retainedApplicationName = 'SlaxReader-ios-debug-identity-757-group-only.app';
export const retainedExecutableSHA256 = 'afca590846175cce828b550f5c92b17096b706c214de67ea1d6d1a380eebd97f';
export const fixtureBundleIdentifier = 'app.slax.reader.storekitfixture';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const sourceInputNames = Object.freeze(['prepare.mjs', 'prepare-lib.mjs', 'bind-preflight.mjs', 'StoreKitFixtureControl.swift', 'NativeStoreKitFixtureApp.tsx', 'contract.ts', '../../index.ts', '../../src/payments/expo-store.ts', '../../src/payments/controller.ts', '../../src/domain/session.ts', '../../src/data/preferences.ts', '../../package.json']);
export function validateSourceInputs(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...sourceInputNames].sort(), 'Only the exact twelve public fixture source names are accepted');
  assert(Object.values(value).every(digest => typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest)), 'Every public fixture input requires a SHA-256 digest');
  return sourceInputNames;
}
export function verifySourceInputs(value, read) {
  // Validate the complete closed manifest before making even the first read callback.
  for (const name of validateSourceInputs(value)) assert.equal(sha256(read(name)), value[name], 'Reviewed source changed after preparation');
}
export const generatedInputNames = Object.freeze(['StoreKitFixtureControl.xcodeproj/project.pbxproj', 'StoreKitFixtureControl.xcodeproj/xcshareddata/xcschemes/StoreKitFixtureControl.xcscheme', 'StoreKitFixtureControl.swift']);
export function verifyGeneratedInputs(value, read) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...generatedInputNames].sort(), 'Only the exact three generated project inputs are accepted');
  assert(Object.values(value).every(digest => typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest)), 'Every generated project input requires a SHA-256 digest');
  // Validate every key and digest before reading the copied Swift or generated project/scheme.
  for (const name of generatedInputNames) assert.equal(sha256(read(name)), value[name], 'Generated native test input changed after preparation');
}
export function assertControlledProjectDirectory(directory, temporaryRoot) {
  assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink() && realpathSync(directory) === directory && /^project-[a-zA-Z0-9]+$/.test(path.basename(directory)));
  const owner = path.dirname(directory);
  assert(lstatSync(owner).isDirectory() && !lstatSync(owner).isSymbolicLink() && realpathSync(owner) === owner && path.dirname(owner) === temporaryRoot && /^slax-native-local-storekit-[a-zA-Z0-9]+$/.test(path.basename(owner)), 'Only a canonical immediate system-temp owner directory is allowed');
  return owner;
}

/** Scan names and metadata first. Forbidden file contents are never opened. */
export function publicArtifactFiles(directory) {
  assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink() && realpathSync(directory) === path.resolve(directory), 'A canonical public artifact directory is required');
  const files = [];
  const visit = (current, relative = '') => {
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      const lower = entry.name.toLowerCase();
      assert(!/^(?:\.env|\.dev\.vars|googleservice|google[-_]services)/.test(lower) && !/(?:credential|private[-_ ]?key|secret)/.test(lower) && !/\.(?:p12|p8|pem|key|mobileprovision)$/.test(lower), 'An operator configuration or signing filename prevents cloning');
      const file = path.join(current, entry.name), stat = lstatSync(file), name = path.join(relative, entry.name);
      assert(!stat.isSymbolicLink(), 'Symbolic links are prohibited in the controlled artifact');
      if (stat.isDirectory()) visit(file, name);
      else {assert(stat.isFile(), 'Only regular public artifact files may be cloned'); files.push(name);}
    }
  };
  visit(directory); return files.sort();
}
export function readPublicArtifactHashes(directory, read = readFileSync) {
  const names = publicArtifactFiles(directory);
  return Object.fromEntries(names.map(name => [name, sha256(read(path.join(directory, name)))]));
}

/** Signing changes link-edit bytes; every actual file-backed native section must agree. */
export function compiledSections(file) {
  const bytes = readFileSync(file);
  assert(bytes.length >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf, 'Only the retained thin arm64 simulator Mach-O is accepted');
  const sections = []; let offset = 32;
  for (let index = 0; index < bytes.readUInt32LE(16); index++) {
    assert(offset + 8 <= bytes.length); const type = bytes.readUInt32LE(offset), length = bytes.readUInt32LE(offset + 4);
    assert(length >= 8 && offset + length <= bytes.length);
    if (type === 0x19) {
      assert(length >= 72); const count = bytes.readUInt32LE(offset + 64); assert(length >= 72 + count * 80);
      for (let number = 0; number < count; number++) {
        const start = offset + 72 + number * 80, size = Number(bytes.readBigUInt64LE(start + 40)), location = bytes.readUInt32LE(start + 48), flags = bytes.readUInt32LE(start + 64) & 255;
        assert(Number.isSafeInteger(size));
        if (size && ![1, 12, 18].includes(flags)) {
          assert(location > 0 && location + size <= bytes.length);
          sections.push({segment: bytes.subarray(start + 16, start + 32).toString().replace(/\0.*$/, ''), section: bytes.subarray(start, start + 16).toString().replace(/\0.*$/, ''), size, sha256: sha256(bytes.subarray(location, location + size))});
        }
      }
    }
    offset += length;
  }
  assert(sections.some(value => value.segment === '__TEXT' && value.section === '__text')); return sections;
}

export function localConfiguration({nonce, configurationIdentifier}) {
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nonce) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(configurationIdentifier));
  const prefix = `slax.local.fixture.${nonce.toLowerCase().replaceAll('-', '')}.`;
  const localized = (name, description) => [{description, displayName: name, locale: 'en_US'}];
  return {identifier: configurationIdentifier, nonRenewingSubscriptions: [], products: [{displayPrice: '0.99', familyShareable: false, internalID: `${configurationIdentifier}-probe`, localizations: localized('Local calibration', 'Synthetic Xcode-only calibration'), productID: `${prefix}probe`, referenceName: 'Synthetic calibration', type: 'NonConsumable'}], settings: {_failTransactionsEnabled: false, _locale: 'en_US', _storefront: 'USA'}, subscriptionGroups: [{id: configurationIdentifier, localizations: [], name: 'Synthetic local subscriptions', subscriptions: [{adHocOffers: [], codeOffers: [], displayPrice: '0.99', familyShareable: false, groupNumber: 1, internalID: `${configurationIdentifier}-monthly`, introductoryOffer: null, localizations: localized('Local monthly fixture', 'Synthetic Xcode-only subscription'), productID: `${prefix}monthly`, recurringSubscriptionPeriod: 'P1M', referenceName: 'Synthetic monthly', type: 'RecurringSubscription'}]}], version: {major: 3, minor: 0}};
}

export function verifyLocalConfiguration(config, input) {
  assert(config.identifier === input.configurationIdentifier && config.version?.major === 3 && config.version?.minor === 0);
  assert(config.products?.length === 1 && config.nonRenewingSubscriptions?.length === 0 && config.subscriptionGroups?.length === 1 && config.subscriptionGroups[0].subscriptions?.length === 1);
  assert(config.products[0].productID === input.calibrationProduct && config.products[0].type === 'NonConsumable');
  assert(config.subscriptionGroups[0].subscriptions[0].productID === input.monthlyProduct && config.subscriptionGroups[0].subscriptions[0].type === 'RecurringSubscription' && config.subscriptionGroups[0].subscriptions[0].recurringSubscriptionPeriod === 'P1M');
  assert(config.products[0].localizations[0].locale === 'en_US' && config.settings._storefront === 'USA');
  return true;
}

export function validateNativePreflightReceipt(summary, manifest, input) {
  assert(summary.result === 'Passed' && summary.totalTestCount === 1 && summary.passedTests === 1 && summary.failedTests === 0 && summary.skippedTests === 0 && summary.expectedFailures === 0 && summary.testFailures?.length === 0, 'Only a completed passing native calibration can enable the adapter');
  const devices = summary.devicesAndConfigurations;
  assert(devices?.length === 1 && devices[0].device.deviceId === input.device && devices[0].device.platform === 'iOS Simulator' && devices[0].device.architecture === 'arm64');
  assert(Number.isFinite(summary.startTime) && Number.isFinite(summary.finishTime) && summary.startTime * 1000 >= input.createdAt && summary.finishTime >= summary.startTime);
  assert(Array.isArray(manifest) && manifest.length === 1 && manifest[0].testIdentifier === 'StoreKitFixtureControl/testNativeXcodeConfigurationPreflight()');
  const proof = manifest[0].attachments.filter(value => value.suggestedHumanReadableName?.startsWith('storekit-native-xcode-preflight_'));
  assert(proof.length === 1 && proof[0].isAssociatedWithFailure === false && proof[0].deviceId === input.device && /^[0-9a-f-]{36}\.json$/i.test(proof[0].exportedFileName) && proof[0].timestamp >= summary.startTime && proof[0].timestamp <= summary.finishTime, 'A unique native calibration attachment is required');
  return proof[0].exportedFileName;
}
