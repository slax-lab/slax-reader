import {Platform} from 'react-native';
import type {LoginRequest} from '../../../src/data/api';

export type LoginProvider = 'google' | 'apple';
export async function authenticate(provider: LoginProvider): Promise<LoginRequest> {
  if (!__DEV__ || process.env.EXPO_PUBLIC_SLAX_API_URL !== 'http://127.0.0.1:8198') throw new Error('Synthetic provider is restricted to isolated acceptance');
  return {type: provider, platform: Platform.OS === 'ios' ? 'ios' : 'android', code: 'synthetic-provider-success', redirect_uri: '', id_token: ''};
}
