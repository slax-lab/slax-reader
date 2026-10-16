import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

const localStoreKit = __DEV__ && process.env.EXPO_PUBLIC_SLAX_STOREKIT_FIXTURE === '1';
if (localStoreKit && (process.env.EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE || process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE)) throw new Error('Choose one isolated development fixture');
const Root = localStoreKit
  ? require('./tests/payments-native/NativeStoreKitFixtureApp').default
  : __DEV__ && process.env.EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE === '1'
  ? require('./tests/data/NativeAdoptionFixtureApp').default
  : __DEV__ && Boolean(process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE)
    ? require('./fixtures/FixtureApp').default
    : require('./src/App').default;
registerRootComponent(Root);
