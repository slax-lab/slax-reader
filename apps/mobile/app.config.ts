import type { ExpoConfig } from 'expo/config';
import sourceAuth from './assets/source-auth-public.json';
import {applyMobileEnvironment} from './tooling/deploy-environment.cjs';
import {readBuildVersion} from './tooling/build-version.cjs';
applyMobileEnvironment();
const uiFixture = Boolean(process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE);
const fixtureIdentity = process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE_ID ?? '';
if (fixtureIdentity && (!uiFixture || !/^[a-z0-9]{1,24}$/.test(fixtureIdentity))) throw new Error('Fixture identity must be a lowercase alphanumeric suffix used only by UI fixtures');
const fixtureAndroidId = `com.slax.reader.uifixture${fixtureIdentity ? `.${fixtureIdentity}` : ''}`;
const fixtureIosId = `app.slax.reader.uifixture${fixtureIdentity ? `.${fixtureIdentity}` : ''}`;
const fixtureScheme = `slaxreader-ui-fixture${fixtureIdentity ? `-${fixtureIdentity}` : ''}`;
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
  scheme: uiFixture ? fixtureScheme : [sourceAuth.iosApplicationScheme, 'slaxreader'],
  icon: './assets/app-icon.png',
  ios: {
    bundleIdentifier: uiFixture ? fixtureIosId : 'app.slax.reader',
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
    package: uiFixture ? fixtureAndroidId : 'com.slax.reader',
    ...(firebaseAndroidConfig ? {googleServicesFile: firebaseAndroidConfig} : {}),
    versionCode: Number(buildVersion.build),
    predictiveBackGestureEnabled: true,
    // expo-sensors declares ACTIVITY_RECOGNITION for its Pedometer/DeviceMotion
    // modules; the app only reads the accelerometer, so drop the permission and
    // avoid the Play health-features declaration requirement.
    blockedPermissions: ['android.permission.ACTIVITY_RECOGNITION'],
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
    // Reader images are only ever saved (never read back): add-only iOS access, no Android media-read permissions.
    ['expo-media-library', {photosPermission: false, savePhotosPermission: 'Slax Reader saves images you choose from articles to your photo library.', granularPermissions: []}],
    ...providerPlugins,
  ],
  extra: {
    eas: {
      projectId: 'f8949909-ddbf-49f8-a42d-9e70a9c77fda',
      ...(!uiFixture ? {
        build: {
          experimental: {
            ios: {
              appExtensions: [{
                targetName: 'SlaxShare',
                bundleIdentifier: 'app.slax.reader.share',
                entitlements: {'com.apple.security.application-groups': ['group.app.slax.reader']},
              }],
            },
          },
        },
      } : {}),
    },
  },
};

export default config;
