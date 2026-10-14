import assert from 'node:assert/strict';
import {test} from 'node:test';
import {STOREKIT_FIXTURE_BUNDLE, assertUnchangedStoreKitRun, validateStoreKitInput, validateStoreKitPreflight} from './contract.ts';
const device = '88E63005-F681-45A6-AF8D-BEFE4E27584D', nonce = '892f62ab-a252-4dbd-9168-545c99aeeead', now = 1791664000000;
const containerPath = `/Users/fixture/Library/Developer/CoreSimulator/Devices/${device}/data/Containers/Data/Application/A173E8D1-73F7-4F94-ACB1-83363301D15A`;
const input = {kind: 'slax-controlled-local-storekit-input', version: 1, device, runId: 'local-fixture', nonce, createdAt: now - 1000, bundleIdentifier: STOREKIT_FIXTURE_BUNDLE, containerPath, orderId: '64fda2b8-72eb-4b3e-9236-7ff59b125022', monthlyProduct: `slax.local.fixture.${nonce.replaceAll('-', '')}.monthly`, calibrationProduct: `slax.local.fixture.${nonce.replaceAll('-', '')}.probe`, configurationIdentifier: '214d9f06-8e09-4bc8-8c92-c58fe12c3ff9'};
const proof = {kind: 'slax-controlled-native-storekit-preflight', version: 1, device, runId: input.runId, nonce, createdAt: now, bundleIdentifier: STOREKIT_FIXTURE_BUNDLE, configurationIdentifier: input.configurationIdentifier, calibrationProduct: input.calibrationProduct, environment: 'Xcode', configurationMutationSucceeded: true, calibrationFinished: true, productIdentifiers: [input.monthlyProduct, input.calibrationProduct]};
test('a fresh exact synthetic catalog and native Xcode proof are accepted', () => {
  const accepted = validateStoreKitInput(input, `${containerPath}/Documents`, now);
  assert.equal(validateStoreKitPreflight(proof, accepted, now).environment, 'Xcode');
});
test('production app, product, another container, stale request and extra payload are refused', () => {
  for (const invalid of [{...input, bundleIdentifier: 'app.slax.reader'}, {...input, monthlyProduct: 'slax.reader.monthly'}, {...input, containerPath: containerPath.replace(device, '522DD84F-9C57-440C-93F0-5F63F61C8A6B')}, {...input, createdAt: now - 21 * 60_000}, {...input, auth_token: 'not-permitted'}, {...input, containerPath: `${containerPath}/../A173E8D1-73F7-4F94-ACB1-83363301D15A`}]) assert.throws(() => validateStoreKitInput(invalid, `${containerPath}/Documents`, now));
});
test('missing native environment, unfinished calibration, wrong nonce and wrong catalog cannot enable the adapter', () => {
  const accepted = validateStoreKitInput(input, `${containerPath}/Documents`, now);
  for (const invalid of [{...proof, environment: 'Sandbox'}, {...proof, environment: 'Production'}, {...proof, calibrationFinished: false}, {...proof, configurationMutationSucceeded: false}, {...proof, nonce: '64fda2b8-72eb-4b3e-9236-7ff59b125022'}, {...proof, productIdentifiers: [input.monthlyProduct, 'slax.reader.monthly']}, {...proof, productIdentifiers: [input.monthlyProduct, input.monthlyProduct]}, {...proof, receipt: 'must-not-persist'}]) assert.throws(() => validateStoreKitPreflight(invalid, accepted, now));
});
test('an active adapter cannot adopt a replacement fresh order, request or native proof', () => {
  const accepted = validateStoreKitInput(input, `${containerPath}/Documents`, now), verified = validateStoreKitPreflight(proof, accepted, now);
  assertUnchangedStoreKitRun(input, proof, accepted, verified, `${containerPath}/Documents`, now);
  assert.throws(() => assertUnchangedStoreKitRun({...input, orderId: nonce}, proof, accepted, verified, `${containerPath}/Documents`, now));
  assert.throws(() => assertUnchangedStoreKitRun(input, {...proof, createdAt: now - 1}, accepted, verified, `${containerPath}/Documents`, now));
  assert.throws(() => assertUnchangedStoreKitRun(input, {...proof, productIdentifiers: [...proof.productIdentifiers].reverse()}, accepted, verified, `${containerPath}/Documents`, now));
});
