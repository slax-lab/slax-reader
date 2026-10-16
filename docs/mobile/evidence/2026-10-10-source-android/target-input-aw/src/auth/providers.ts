import { Platform } from 'react-native';
import { mobileConfig } from '../config';
import type { LoginRequest } from '../data/api';

export type LoginProvider = 'google' | 'apple';
export async function authenticate(provider: LoginProvider): Promise<LoginRequest | null> {
  if (provider === 'google') {
    const { GoogleOneTapSignIn, isErrorWithCode, statusCodes } = await import('react-native-nitro-google-signin');
    if (!mobileConfig.googleWebClientId || (Platform.OS === 'ios' && !mobileConfig.googleIosClientId)) {
      throw new Error('Google Sign-In client IDs have not been configured for this build');
    }
    GoogleOneTapSignIn.configure({webClientId: mobileConfig.googleWebClientId, iosClientId: mobileConfig.googleIosClientId, offlineAccess: false, autoSelectOnSignIn: false});
    try {
      await GoogleOneTapSignIn.checkPlayServices();
      // The original iOS button always presents Google sign-in, including when
      // the native SDK still has an account after the app session was cleared.
      let response = Platform.OS === 'ios' ? await GoogleOneTapSignIn.createAccount() : await GoogleOneTapSignIn.signIn();
      if (Platform.OS === 'android' && response.type === 'noSavedCredentialFound') response = await GoogleOneTapSignIn.createAccount();
      if (response.type === 'cancelled') return null;
      if (response.type !== 'success' || !response.data?.idToken) throw new Error('Google did not return an identity token');
      return {type: 'google', platform: mobileConfig.platform, code: response.data.idToken, redirect_uri: '', id_token: ''};
    } catch (error) {
      if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) return null;
      throw error;
    }
  }
  if (Platform.OS !== 'ios') return null;
  const Apple = await import('expo-apple-authentication');
  try {
    const credential = await Apple.signInAsync({requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL]});
    if (!credential.authorizationCode || !credential.identityToken) throw new Error('Apple did not return an authorization code and identity token');
    return {type: 'apple', platform: 'ios', code: credential.authorizationCode, redirect_uri: '', id_token: credential.identityToken};
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') return null;
    throw error;
  }
}
