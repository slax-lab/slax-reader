import 'react-native-gesture-handler';
import {registerRootComponent} from 'expo';
import App from '../../../src/App';

if (!__DEV__ || process.env.EXPO_PUBLIC_SLAX_API_URL !== 'http://127.0.0.1:8198') throw new Error('Isolated native development acceptance only');
registerRootComponent(App);
