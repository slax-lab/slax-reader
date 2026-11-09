import {useCallback, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {EmailAuthIdentities} from '@slax-reader/contracts/email-auth';
import {emailAuthError} from '../auth/email-auth-errors';
import type {LoginProvider} from '../auth/providers';
import type {LoginRequest, NativeProvider, SlaxApi} from '../data/api';
import type {AppMessageKey} from '../i18n';
import type {AccountScope} from './account-scope';

type IdentitiesApi = Pick<SlaxApi, 'getLoginIdentities' | 'startProviderLink' | 'finishProviderLink'>;

interface LoginIdentityOptions {
  api: IdentitiesApi;
  scope: AccountScope;
  platform: NativeProvider['platform'];
  authenticate(provider: LoginProvider, nonce: string): Promise<LoginRequest | null>;
  fixture: boolean;
}

interface Lifetime {
  current(): boolean;
  read?: AbortController;
  mutation?: AbortController;
}

export function useLoginIdentities({api, scope, platform, authenticate, fixture}: LoginIdentityOptions) {
  const [snapshot, setSnapshot] = useState<{api: IdentitiesApi; scope: AccountScope; value: EmailAuthIdentities}>();
  const [error, setError] = useState<AppMessageKey>();
  const [busy, setBusy] = useState<LoginProvider | null>(null);
  const [emailFlow, setEmailFlow] = useState<{current(): boolean} | null>(null);
  const lifetime = useRef<Lifetime | null>(null);
  const identities = snapshot?.scope === scope && snapshot.api === api && snapshot.value.enabled ? snapshot.value : null;

  useFocusEffect(useCallback(() => {
    setError(undefined);
    setBusy(null);
    setEmailFlow(null);
    if (fixture || !scope.isCurrent()) return;

    const generation: Lifetime = {current: () => lifetime.current === generation && scope.isCurrent()};
    lifetime.current = generation;
    async function refresh() {
      if (!generation.current() || generation.mutation) return;
      generation.read?.abort();
      const read = new AbortController();
      generation.read = read;
      try {
        const value = await api.getLoginIdentities(read.signal);
        if (generation.current() && !read.signal.aborted) {
          setSnapshot({api, scope, value});
          if (!value.enabled || value.email !== null) setEmailFlow(null);
        }
      } catch {
        // Feature availability is unknown on older or temporarily unavailable servers.
      } finally {
        if (generation.read === read) generation.read = undefined;
      }
    }
    if (AppState.currentState === 'active') void refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
      else generation.read?.abort();
    });
    return () => {
      lifetime.current = null;
      generation.read?.abort();
      generation.mutation?.abort();
      subscription.remove();
    };
  }, [api, scope, fixture]));

  function updateIdentities(values: Partial<EmailAuthIdentities>) {
    setSnapshot(previous => previous?.scope === scope && previous.api === api
      ? {...previous, value: {...previous.value, ...values}}
      : previous);
  }

  function openEmail() {
    const generation = lifetime.current;
    if (!identities || identities.email !== null || !generation?.current() || generation.mutation) return;
    setError(undefined);
    setEmailFlow(generation);
  }

  function emailLinked({email}: {email: string}) {
    if (!emailFlow?.current()) return;
    lifetime.current?.read?.abort();
    updateIdentities({email});
    setEmailFlow(null);
  }

  async function linkProvider(type: LoginProvider) {
    const generation = lifetime.current;
    if (type === 'apple' && platform === 'android') return;
    if (!identities || identities[type] || emailFlow || !generation?.current() || generation.mutation) return;
    const mutation = new AbortController();
    generation.mutation = mutation;
    const current = () => generation.current() && !mutation.signal.aborted;
    generation.read?.abort();
    setError(undefined);
    setBusy(type);
    try {
      const {state, nonce} = await api.startProviderLink({type, platform}, mutation.signal);
      if (!current()) return;
      const credential = await authenticate(type, nonce);
      if (!credential || !current()) return;
      await api.finishProviderLink({...credential, state, type, platform}, mutation.signal);
      if (current()) updateIdentities({[type]: true});
    } catch (reason) {
      if (current()) setError(emailAuthError(reason) ?? 'email_auth_link_failed');
    } finally {
      generation.mutation = undefined;
      if (current()) setBusy(null);
    }
  }

  return {identities, error, busy, emailFlow, openEmail, emailLinked, closeEmail: () => setEmailFlow(null), linkProvider};
}
