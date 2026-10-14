import assert from 'node:assert/strict';

export const productionEnvironment = Object.freeze({
  EXPO_PUBLIC_SLAX_API_URL: 'https://api-reader.slax.com',
  EXPO_PUBLIC_SLAX_BETA_API_URL: 'https://api-reader-beta.slax.com',
  EXPO_PUBLIC_SLAX_WEB_URL: 'https://r.slax.com',
  EXPO_PUBLIC_SLAX_WEB_DOMAIN: '.slax.com',
});

export function checkProductionEnvironment(environment) {
  for (const [key, expected] of Object.entries(productionEnvironment)) {
    assert(environment[key] === undefined || environment[key] === expected,
      `${key} must use the production value for TestFlight; test overrides are local-only`);
  }
}

export function checkProductionBundle(info, bundle) {
  assert(info.SlaxApiBaseURL === productionEnvironment.EXPO_PUBLIC_SLAX_API_URL,
    'Application metadata contains a non-production API origin; regenerate the native project');
  assert(info.SlaxApiBetaURL === productionEnvironment.EXPO_PUBLIC_SLAX_BETA_API_URL,
    'Application metadata contains an unexpected beta API origin');
  if (bundle) {
    assert(bundle.includes(Buffer.from(productionEnvironment.EXPO_PUBLIC_SLAX_API_URL)),
      'The embedded JavaScript bundle does not contain the production API origin');
    assert(!bundle.includes(Buffer.from('https://reader-api.slax.dev')),
      'The embedded JavaScript bundle contains the local test API origin');
  }
}
