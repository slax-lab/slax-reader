import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {assertControlledProjectDirectory, generatedInputNames, localConfiguration, publicArtifactFiles, readPublicArtifactHashes, sha256, sourceInputNames, validateNativePreflightReceipt, verifyGeneratedInputs, verifyLocalConfiguration, verifySourceInputs} from './prepare-lib.mjs';

test('public artifact name scan refuses operator filenames before any clone/output', () => {
  for (const forbidden of ['GoogleService-Info.plist', 'google-services.json', '.env', '.envproduction', '.env.production', '.dev.vars', '.dev.varsbackup', 'credentials.json', 'private_key.txt', 'AuthKey.p8', 'distribution.p12', 'embedded.mobileprovision']) {
    const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'slax-storekit-guard-test-'))), source = path.join(parent, 'public.app'), output = path.join(parent, 'cloned.app'); mkdirSync(source);
    // The forbidden directory cannot have file contents read; the scan must reject its name.
    mkdirSync(path.join(source, forbidden));
    let reads = 0;
    try {assert.throws(() => {readPublicArtifactHashes(source, () => {reads++; throw new Error('Forbidden content read');}); mkdirSync(output);}, /filename prevents cloning/); assert.equal(reads, 0); assert.equal(existsSync(output), false);} finally {rmSync(parent, {recursive: true, force: true});}
  }
});
test('a substituted source manifest is refused before any read callback', () => {
  const closed = Object.fromEntries(sourceInputNames.map(name => [name, sha256('public')]));
  let reads = 0; verifySourceInputs(closed, () => {reads++; return 'public';}); assert.equal(reads, 12);
  for (const value of [{...closed, '../../.env': sha256('public')}, Object.fromEntries(Object.entries(closed).map(([name, hash], index) => [index === 0 ? '/tmp/credentials.json' : name, hash])), {...closed, 'contract.ts': 'not-a-sha'}, {...closed, 'contract.ts': null}]) {
    reads = 0; assert.throws(() => verifySourceInputs(value, () => {reads++; return 'public';})); assert.equal(reads, 0);
  }
});
test('a similarly named owner nested outside the immediate system-temp root is refused before marker reads', () => {
  const temp = realpathSync(tmpdir()), owner = realpathSync(mkdtempSync(path.join(temp, 'slax-native-local-storekit-'))), project = path.join(owner, 'project-Test'); mkdirSync(project);
  const outside = realpathSync(mkdtempSync(path.join(temp, 'slax-storekit-guard-test-'))), nestedOwner = path.join(outside, 'slax-native-local-storekit-Test'), nestedProject = path.join(nestedOwner, 'project-Test'); mkdirSync(nestedProject, {recursive: true});
  try {
    assert.equal(assertControlledProjectDirectory(project, temp), owner);
    let reads = 0; assert.throws(() => {assertControlledProjectDirectory(nestedProject, temp); reads++;}, /immediate system-temp/); assert.equal(reads, 0);
    symlinkSync(project, path.join(owner, 'project-Alias')); assert.throws(() => assertControlledProjectDirectory(path.join(owner, 'project-Alias'), temp));
  } finally {rmSync(owner, {recursive: true, force: true}); rmSync(outside, {recursive: true, force: true});}
});
test('a generated project manifest cannot substitute other paths or malformed hashes before any read', () => {
  const closed = Object.fromEntries(generatedInputNames.map(name => [name, sha256('public generated input')]));
  let reads = 0; verifyGeneratedInputs(closed, () => {reads++; return 'public generated input';}); assert.equal(reads, 3);
  for (const value of [{...closed, '../.env': sha256('public')}, Object.fromEntries(Object.entries(closed).map(([name, hash], index) => [index === 0 ? '/tmp/credentials.json' : name, hash])), {...closed, 'StoreKitFixtureControl.swift': 'invalid'}, {...closed, 'StoreKitFixtureControl.swift': null}, undefined]) {
    reads = 0; assert.throws(() => verifyGeneratedInputs(value, () => {reads++; return 'public';})); assert.equal(reads, 0);
  }
});
test('admission rejects a changed generated scheme or copied Swift even with unchanged original source hashes', () => {
  const generated = Object.fromEntries(generatedInputNames.map(name => [name, `public bytes for ${name}`]));
  const hashes = Object.fromEntries(generatedInputNames.map(name => [name, sha256(generated[name])]));
  verifyGeneratedInputs(hashes, name => generated[name]);
  for (const changed of generatedInputNames) assert.throws(() => verifyGeneratedInputs(hashes, name => name === changed ? `${generated[name]} changed` : generated[name]), /changed after preparation/);
});
test('a public artifact symlink is refused, while regular public resources are inventoried', () => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'slax-storekit-guard-test-'))), source = path.join(parent, 'public.app'); mkdirSync(source);
  try {writeFileSync(path.join(source, 'Info.plist'), 'public'); assert.deepEqual(publicArtifactFiles(source), ['Info.plist']); symlinkSync(path.join(source, 'Info.plist'), path.join(source, 'alias.plist')); assert.throws(() => publicArtifactFiles(source), /Symbolic links/);} finally {rmSync(parent, {recursive: true, force: true});}
});
test('the generated local configuration contains only run-specific synthetic products', () => {
  const nonce = '892f62ab-a252-4dbd-9168-545c99aeeead', configurationIdentifier = '214d9f06-8e09-4bc8-8c92-c58fe12c3ff9', config = localConfiguration({nonce, configurationIdentifier});
  const input = {configurationIdentifier, monthlyProduct: `slax.local.fixture.${nonce.replaceAll('-', '')}.monthly`, calibrationProduct: `slax.local.fixture.${nonce.replaceAll('-', '')}.probe`};
  assert.equal(verifyLocalConfiguration(config, input), true);
  assert.throws(() => verifyLocalConfiguration({...config, products: [{...config.products[0], productID: 'slax.reader.monthly'}]}, input));
  assert.throws(() => verifyLocalConfiguration({...config, products: [...config.products, config.products[0]]}, input));
  assert.throws(() => verifyLocalConfiguration({...config, subscriptionGroups: [{...config.subscriptionGroups[0], subscriptions: [{...config.subscriptionGroups[0].subscriptions[0], recurringSubscriptionPeriod: 'P1Y'}]}]}, input));
});
test('native admission requires one passed calibration on the allocated device and its actual nonfailed attachment', () => {
  const input = {device: '88E63005-F681-45A6-AF8D-BEFE4E27584D', createdAt: 1_000_000};
  const summary = {result: 'Passed', totalTestCount: 1, passedTests: 1, failedTests: 0, skippedTests: 0, expectedFailures: 0, testFailures: [], startTime: 1001, finishTime: 1010, devicesAndConfigurations: [{device: {deviceId: input.device, platform: 'iOS Simulator', architecture: 'arm64'}}]};
  const attachment = {suggestedHumanReadableName: 'storekit-native-xcode-preflight_0_public.json', isAssociatedWithFailure: false, deviceId: input.device, exportedFileName: '214d9f06-8e09-4bc8-8c92-c58fe12c3ff9.json', timestamp: 1009};
  const manifest = [{testIdentifier: 'StoreKitFixtureControl/testNativeXcodeConfigurationPreflight()', attachments: [attachment]}];
  assert.equal(validateNativePreflightReceipt(summary, manifest, input), attachment.exportedFileName);
  for (const value of [{...summary, result: 'Failed'}, {...summary, skippedTests: 1}, {...summary, totalTestCount: 2}, {...summary, startTime: 999}, {...summary, devicesAndConfigurations: [{device: {...summary.devicesAndConfigurations[0].device, deviceId: '522DD84F-9C57-440C-93F0-5F63F61C8A6B'}}]}]) assert.throws(() => validateNativePreflightReceipt(value, manifest, input));
  for (const value of [[{...manifest[0], testIdentifier: 'StoreKitFixtureControl/testActualAdapterPurchaseAndRestore()'}], [{...manifest[0], attachments: [{...attachment, isAssociatedWithFailure: true}]}], [{...manifest[0], attachments: [{...attachment, exportedFileName: '../unsafe.json'}]}], [{...manifest[0], attachments: [attachment, attachment]}]]) assert.throws(() => validateNativePreflightReceipt(summary, value, input));
});
test('the actual application entry excludes local StoreKit in Release and rejects mixed fixture flags', () => {
  const source = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8').replace(/^import .*;\s*$/gm, '');
  const run = (dev, env) => {let selected; const loaded = []; runInNewContext(source, {__DEV__: dev, process: {env}, require(name) {loaded.push(name); return {default: name};}, registerRootComponent(value) {selected = value;}}); return {selected, loaded};};
  assert.deepEqual(run(false, {EXPO_PUBLIC_SLAX_STOREKIT_FIXTURE: '1'}), {selected: './src/App', loaded: ['./src/App']});
  assert.deepEqual(run(true, {EXPO_PUBLIC_SLAX_STOREKIT_FIXTURE: '1'}), {selected: './tests/payments-native/NativeStoreKitFixtureApp', loaded: ['./tests/payments-native/NativeStoreKitFixtureApp']});
  for (const competing of ['EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE', 'EXPO_PUBLIC_SLAX_UI_FIXTURE']) assert.throws(() => run(true, {EXPO_PUBLIC_SLAX_STOREKIT_FIXTURE: '1', [competing]: '1'}), /Choose one isolated/);
});
