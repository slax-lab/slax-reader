import type {AuthenticationResponseJSON, PasskeyAuthenticationChallenge, PasskeyLoginRequest, PasskeyRegistrationChallenge, PasskeyRegistrationInput, RegistrationResponseJSON} from '@slax-reader/contracts/passkey';
import type {LoginResponse} from '../data/api';

export interface NativePasskeys {
  authenticate(options: PasskeyAuthenticationChallenge['options'], signal: AbortSignal): Promise<AuthenticationResponseJSON | null>;
  register(options: PasskeyRegistrationChallenge['options'], signal: AbortSignal): Promise<RegistrationResponseJSON | null>;
}

export async function loginWithPasskey({email, signal, isCurrent, api, native}: {
  email: string; signal: AbortSignal; isCurrent(): boolean;
  api: {getPasskeyLoginChallenge(email: string, signal: AbortSignal): Promise<PasskeyAuthenticationChallenge>; loginPasskey(body: PasskeyLoginRequest, signal: AbortSignal): Promise<LoginResponse>};
  native: Pick<NativePasskeys, 'authenticate'>;
}): Promise<LoginResponse | null> {
  const challenge = await api.getPasskeyLoginChallenge(email, signal);
  if (signal.aborted || !isCurrent()) return null;
  const credential = await native.authenticate(challenge.options, signal);
  if (!credential || signal.aborted || !isCurrent()) return null;
  return api.loginPasskey({type: 'passkey', email, request_id: challenge.request_id, credential}, signal);
}

export async function registerPasskey({name, signal, isCurrent, api, native}: {
  name: string; signal: AbortSignal; isCurrent(): boolean;
  api: {getPasskeyRegistrationChallenge(signal: AbortSignal): Promise<PasskeyRegistrationChallenge>; registerPasskey(body: PasskeyRegistrationInput, signal: AbortSignal): Promise<{linked: true}>};
  native: Pick<NativePasskeys, 'register'>;
}): Promise<boolean> {
  const challenge = await api.getPasskeyRegistrationChallenge(signal);
  if (signal.aborted || !isCurrent()) return false;
  const credential = await native.register(challenge.options, signal);
  if (!credential || signal.aborted || !isCurrent()) return false;
  await api.registerPasskey({type: 'passkey', request_id: challenge.request_id, credential, name}, signal);
  return !signal.aborted && isCurrent();
}
