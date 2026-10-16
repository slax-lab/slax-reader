import assert from 'node:assert/strict';
import test from 'node:test';
import {checkProductionBundle, checkProductionEnvironment, productionEnvironment} from '../../tooling/release-environment.mjs';

const metadata = {SlaxApiBaseURL: productionEnvironment.EXPO_PUBLIC_SLAX_API_URL, SlaxApiBetaURL: productionEnvironment.EXPO_PUBLIC_SLAX_BETA_API_URL};

test('TestFlight accepts production defaults and rejects local test overrides', () => {
  checkProductionEnvironment({});
  checkProductionEnvironment(productionEnvironment);
  for (const key of Object.keys(productionEnvironment)) {
    assert.throws(() => checkProductionEnvironment({...productionEnvironment, [key]: 'https://reader-api.slax.dev'}), /production value/);
    assert.throws(() => checkProductionEnvironment({...productionEnvironment, [key]: ''}), /production value/);
  }
});

test('artifact validation rejects stale native metadata and test API bytecode', () => {
  const productionBytes = Buffer.from('compiled https://api-reader.slax.com application');
  checkProductionBundle(metadata, productionBytes);
  checkProductionBundle(metadata);
  assert.throws(() => checkProductionBundle({...metadata, SlaxApiBaseURL: 'https://reader-api.slax.dev'}, productionBytes), /non-production API/);
  assert.throws(() => checkProductionBundle({...metadata, SlaxApiBetaURL: 'https://reader-api.slax.dev'}, productionBytes), /unexpected beta/);
  assert.throws(() => checkProductionBundle({}, productionBytes), /non-production API/);
  assert.throws(() => checkProductionBundle(metadata, Buffer.from('compiled without api origin')), /does not contain/);
  assert.throws(() => checkProductionBundle(metadata, Buffer.concat([productionBytes, Buffer.from(' https://reader-api.slax.dev')])), /local test API/);
});
