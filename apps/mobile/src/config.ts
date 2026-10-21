import { Platform } from 'react-native';
import Constants from 'expo-constants';
import sourceAuth from '../assets/source-auth-public.json';

/** Public build inputs only. Authentication tokens are held by the native preference store. */
export const mobileConfig = {
  apiUrl: process.env.EXPO_PUBLIC_SLAX_API_URL ?? 'https://api-reader.slax.com',
  betaApiUrl: process.env.EXPO_PUBLIC_SLAX_BETA_API_URL ?? 'https://api-reader-beta.slax.com',
  isBeta: false,
  development: false,
  webUrl: process.env.EXPO_PUBLIC_SLAX_WEB_URL ?? 'https://r.slax.com',
  webDomain: process.env.EXPO_PUBLIC_SLAX_WEB_DOMAIN ?? '.slax.com',
  version: Constants.expoConfig?.version ?? '1.0.0',
  buildNumber: String(Platform.OS === 'ios' ? Constants.expoConfig?.ios?.buildNumber ?? '1' : Constants.expoConfig?.android?.versionCode ?? 1),
  platform: Platform.OS === 'ios' ? 'ios' as const : 'android' as const,
  googleWebClientId: process.env.EXPO_PUBLIC_SLAX_GOOGLE_WEB_CLIENT_ID ?? sourceAuth.googleWebClientId,
  googleIosClientId: process.env.EXPO_PUBLIC_SLAX_GOOGLE_IOS_CLIENT_ID ?? sourceAuth.googleIosClientId,
};
