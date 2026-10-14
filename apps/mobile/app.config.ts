import type { ExpoConfig } from 'expo/config';
import sourceAuth from './assets/source-auth-public.json';
import {applyMobileEnvironment} from './tooling/deploy-environment.cjs';
import {readBuildVersion} from './tooling/build-version.cjs';
applyMobileEnvironment();
const uiFixture = Boolean(process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE);
const fixtureMode = process.env.EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE === '1' || uiFixture;
const buildVersion = fixtureMode ? {version: '1.0.0', build: '1'} : readBuildVersion();
const firebaseIosConfig = fixtureMode ? undefined : process.env.SLAX_MOBILE_FIREBASE_IOS_CONFIG;
const firebaseAndroidConfig = fixtureMode ? undefined : process.env.SLAX_MOBILE_FIREBASE_ANDROID_CONFIG;

const providerPlugins: NonNullable<ExpoConfig['plugins']> = fixtureMode ? [] : [
  ['react-native-nitro-google-signin', {
    iosUrlScheme: process.env.EXPO_PUBLIC_SLAX_GOOGLE_IOS_URL_SCHEME ?? sourceAuth.googleIosUrlScheme,
  }],
];

const config: ExpoConfig = {
  name: 'Slax Reader',
  slug: uiFixture ? 'slax-reader-ui-fixture' : 'slax-reader',
  platforms: ['ios', 'android'],
  version: buildVersion.version,
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  scheme: uiFixture ? 'slaxreader-ui-fixture' : [sourceAuth.iosApplicationScheme, 'slaxreader'],
  icon: './assets/app-icon.png',
  ios: {
    bundleIdentifier: uiFixture ? 'app.slax.reader.uifixture' : 'app.slax.reader',
    ...(firebaseIosConfig ? {googleServicesFile: firebaseIosConfig} : {}),
    buildNumber: buildVersion.build,
    supportsTablet: true,
    entitlements: uiFixture ? {} : { 'com.apple.security.application-groups': ['group.app.slax.reader'] },
    infoPlist: { ITSAppUsesNonExemptEncryption: false, FirebaseAutomaticScreenReportingEnabled: false,
      SlaxApiBaseURL: process.env.EXPO_PUBLIC_SLAX_API_URL ?? 'https://api-reader.slax.com',
      SlaxApiBetaURL: process.env.EXPO_PUBLIC_SLAX_BETA_API_URL ?? 'https://api-reader-beta.slax.com',
      NSAppTransportSecurity: {NSAllowsArbitraryLoads: true},
      ...(process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE === 'reader-pdf-import' ? {UIFileSharingEnabled: true, LSSupportsOpeningDocumentsInPlace: true} : {}),
      ...(fixtureMode ? {FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED: true, FirebaseCrashlyticsCollectionEnabled: false} : {})},
  },
  android: {
    package: uiFixture ? 'com.slax.reader.uifixture' : 'com.slax.reader',
    ...(firebaseAndroidConfig ? {googleServicesFile: firebaseAndroidConfig} : {}),
    versionCode: Number(buildVersion.build),
    predictiveBackGestureEnabled: true,
  },
  plugins: [
    ['./plugins/with-native-compatibility.cjs', {fixtureMode}],
    ...(firebaseIosConfig || firebaseAndroidConfig ? ['./plugins/with-firebase-bootstrap.cjs'] : []),
    ...(!uiFixture ? [['./plugins/with-share.cjs', {
      apiBaseUrl: process.env.EXPO_PUBLIC_SLAX_API_URL ?? 'https://api-reader.slax.com',
      apiBetaUrl: process.env.EXPO_PUBLIC_SLAX_BETA_API_URL ?? 'https://api-reader-beta.slax.com',
      versionName: buildVersion.version,
      versionCode: Number(buildVersion.build),
    }] as NonNullable<ExpoConfig['plugins']>[number]] : []),
    ['expo-dev-client', { launchMode: 'most-recent' }],
    'expo-secure-store',
    'expo-localization',
    'expo-apple-authentication',
    ['expo-iap', {module: 'expo-iap'}],
    ...providerPlugins,
  ],
};

export default config;
