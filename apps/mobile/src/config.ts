import { Platform } from 'react-native';
import Constants from 'expo-constants';
import sourceAuth from '../assets/source-auth-public.json';

const apiUrl = process.env.EXPO_PUBLIC_SLAX_API_URL ?? 'https://api-reader.slax.com';
const fixture = Boolean(process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE) || process.env.EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE === '1';
// The production stream admits only beta/production records, so only release builds against the
// production API default to it; development, fixtures and custom origins send nothing unless set.
const clientErrorIngestUrl = process.env.EXPO_PUBLIC_SLAX_CLIENT_ERROR_INGEST_URL
  ?? (!__DEV__ && !fixture && apiUrl === 'https://api-reader.slax.com' ? 'https://db5b4d9bd7414cb59b6b0e09ce3229b0.ingest.cloudflare.com' : '');

/** Public build inputs only. Authentication tokens are held by the native preference store. */
export const mobileConfig = {
  apiUrl,
  betaApiUrl: process.env.EXPO_PUBLIC_SLAX_BETA_API_URL ?? 'https://api-reader-beta.slax.com',
  isBeta: false,
  development: false,
  webUrl: process.env.EXPO_PUBLIC_SLAX_WEB_URL ?? 'https://r.slax.com',
  webDomain: process.env.EXPO_PUBLIC_SLAX_WEB_DOMAIN ?? '.slax.com',
  version: Constants.expoConfig?.version ?? '1.0.0',
  clientErrorIngestUrl,
  buildNumber: String(Platform.OS === 'ios' ? Constants.expoConfig?.ios?.buildNumber ?? '1' : Constants.expoConfig?.android?.versionCode ?? 1),
  platform: Platform.OS === 'ios' ? 'ios' as const : 'android' as const,
  googleWebClientId: process.env.EXPO_PUBLIC_SLAX_GOOGLE_WEB_CLIENT_ID ?? sourceAuth.googleWebClientId,
  googleIosClientId: process.env.EXPO_PUBLIC_SLAX_GOOGLE_IOS_CLIENT_ID ?? sourceAuth.googleIosClientId,
};
