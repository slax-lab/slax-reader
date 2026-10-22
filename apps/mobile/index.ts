import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

const localStoreKit = __DEV__ && process.env.EXPO_PUBLIC_SLAX_STOREKIT_FIXTURE === '1';
const rssRealSync = __DEV__ && process.env.EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_FIXTURE === '1';
const adoptionFixture = __DEV__ && process.env.EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE === '1';
const uiFixture = __DEV__ && Boolean(process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE);
if (localStoreKit && (adoptionFixture || uiFixture) || rssRealSync && (!uiFixture || process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE !== 'rss-local-native-offline' || process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE_ID !== 'rssacceptance' || localStoreKit || adoptionFixture)) throw new Error('Choose one isolated development fixture');
const Root = localStoreKit
  ? require('./tests/payments-native/NativeStoreKitFixtureApp').default
  : rssRealSync
  ? require('./tests/data/RssRealSyncFixtureApp').default
  : adoptionFixture
  ? require('./tests/data/NativeAdoptionFixtureApp').default
  : uiFixture
    ? require('./fixtures/FixtureApp').default
    : require('./src/App').default;
registerRootComponent(Root);
