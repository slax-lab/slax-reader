/** Public, synthetic-only inputs for the isolated local StoreKit test application. */
export const STOREKIT_FIXTURE_BUNDLE = 'app.slax.reader.storekitfixture';
export const STOREKIT_FIXTURE_INPUT = 'storekit-fixture-input.json';
export const STOREKIT_FIXTURE_PREFLIGHT = 'storekit-fixture-preflight.json';
export const STOREKIT_FIXTURE_REPORT = 'storekit-fixture-report.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface StoreKitFixtureInput {
  kind: 'slax-controlled-local-storekit-input'; version: 1; device: string; runId: string; nonce: string; createdAt: number;
  bundleIdentifier: typeof STOREKIT_FIXTURE_BUNDLE; containerPath: string; orderId: string;
  monthlyProduct: string; calibrationProduct: string; configurationIdentifier: string;
}
export interface StoreKitFixturePreflight {
  kind: 'slax-controlled-native-storekit-preflight'; version: 1; device: string; runId: string; nonce: string; createdAt: number;
  bundleIdentifier: typeof STOREKIT_FIXTURE_BUNDLE; configurationIdentifier: string; calibrationProduct: string;
  environment: 'Xcode'; configurationMutationSucceeded: true; calibrationFinished: true; productIdentifiers: string[];
}
const inputKeys = ['kind', 'version', 'device', 'runId', 'nonce', 'createdAt', 'bundleIdentifier', 'containerPath', 'orderId', 'monthlyProduct', 'calibrationProduct', 'configurationIdentifier'];
const preflightKeys = ['kind', 'version', 'device', 'runId', 'nonce', 'createdAt', 'bundleIdentifier', 'configurationIdentifier', 'calibrationProduct', 'environment', 'configurationMutationSucceeded', 'calibrationFinished', 'productIdentifiers'];
const check: (value: unknown, message: string) => asserts value = (value, message) => {if (!value) throw new Error(message);};
function object(value: unknown, keys: string[]): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value), 'A bounded public fixture object is required');
  const record = value as Record<string, unknown>;
  check(Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key)), 'Unexpected local StoreKit fields'); return record;
}
export function validateStoreKitInput(value: unknown, documentDirectory: string, now = Date.now()): StoreKitFixtureInput {
  const input = object(value, inputKeys);
  check(input.kind === 'slax-controlled-local-storekit-input' && input.version === 1 && input.bundleIdentifier === STOREKIT_FIXTURE_BUNDLE, 'Only the isolated local StoreKit application is accepted');
  check(typeof input.device === 'string' && UUID.test(input.device) && typeof input.nonce === 'string' && UUID.test(input.nonce) && typeof input.orderId === 'string' && UUID.test(input.orderId) && typeof input.configurationIdentifier === 'string' && UUID.test(input.configurationIdentifier), 'Explicit public UUID inputs are required');
  check(typeof input.runId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(input.runId), 'Invalid local run identity');
  check(typeof input.createdAt === 'number' && Number.isSafeInteger(input.createdAt) && input.createdAt <= now && now - input.createdAt <= 20 * 60_000, 'A fresh controlled local request is required');
  const shape = /^\/Users\/[^/]+\/Library\/Developer\/CoreSimulator\/Devices\/([0-9a-f-]{36})\/data\/Containers\/Data\/Application\/([0-9a-f-]{36})$/i;
  const slot = typeof input.containerPath === 'string' ? shape.exec(input.containerPath) : null;
  check(slot && slot[1] === input.device && UUID.test(slot[2]) && documentDirectory === `${input.containerPath}/Documents`, 'Only the exact allocated simulator application container is accepted');
  const skuPrefix = `slax.local.fixture.${input.nonce.toLowerCase().replaceAll('-', '')}.`;
  check(input.monthlyProduct === `${skuPrefix}monthly` && input.calibrationProduct === `${skuPrefix}probe`, 'Real or unrelated StoreKit product identifiers are prohibited');
  return input as unknown as StoreKitFixtureInput;
}
/** A replacement file cannot grant an already initialized adapter a new run. */
export function assertUnchangedStoreKitRun(value: unknown, proof: unknown, input: StoreKitFixtureInput, preflight: StoreKitFixturePreflight, documentDirectory: string, now = Date.now()) {
  const current = validateStoreKitInput(value, documentDirectory, now), currentProof = validateStoreKitPreflight(proof, current, now);
  check(inputKeys.every(key => current[key as keyof StoreKitFixtureInput] === input[key as keyof StoreKitFixtureInput]), 'Local StoreKit request changed while the adapter was active');
  check(preflightKeys.every(key => key === 'productIdentifiers' ? JSON.stringify(currentProof.productIdentifiers) === JSON.stringify(preflight.productIdentifiers) : currentProof[key as keyof StoreKitFixturePreflight] === preflight[key as keyof StoreKitFixturePreflight]), 'Native StoreKit proof changed while the adapter was active');
}
export function validateStoreKitPreflight(value: unknown, input: StoreKitFixtureInput, now = Date.now()): StoreKitFixturePreflight {
  const proof = object(value, preflightKeys);
  check(proof.kind === 'slax-controlled-native-storekit-preflight' && proof.version === 1 && ['device', 'runId', 'nonce', 'bundleIdentifier', 'configurationIdentifier', 'calibrationProduct'].every(key => proof[key] === input[key as keyof StoreKitFixtureInput]), 'Native preflight belongs to another controlled application or run');
  check(proof.environment === 'Xcode' && proof.configurationMutationSucceeded === true && proof.calibrationFinished === true, 'Native Xcode StoreKit preflight must complete before adapter calls');
  check(typeof proof.createdAt === 'number' && Number.isSafeInteger(proof.createdAt) && proof.createdAt >= input.createdAt && proof.createdAt <= now && now - proof.createdAt <= 20 * 60_000, 'Native local configuration proof is stale');
  check(Array.isArray(proof.productIdentifiers) && proof.productIdentifiers.length === 2 && new Set(proof.productIdentifiers).size === 2 && proof.productIdentifiers.includes(input.monthlyProduct) && proof.productIdentifiers.includes(input.calibrationProduct), 'Native catalog must contain the two exact synthetic products');
  return proof as unknown as StoreKitFixturePreflight;
}
