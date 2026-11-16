import {useCallback, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {emailAuthError} from '../auth/email-auth-errors';
import type {LoginProvider} from '../auth/providers';
import type {LinkedPlatform, LoginRequest, NativeProvider, SlaxApi} from '../data/api';
import type {AppMessageKey} from '../i18n';
import type {AccountScope} from './account-scope';

type PlatformsApi = Pick<SlaxApi, 'getLinkedPlatforms' | 'startProviderLink' | 'finishProviderLink'>;

interface LinkedPlatformOptions {
  api: PlatformsApi;
  scope: AccountScope;
  platform: NativeProvider['platform'];
  authenticate(provider: LoginProvider, nonce: string): Promise<LoginRequest | null>;
  fixture: boolean;
}

interface Lifetime {
  current(): boolean;
  refresh(): Promise<void>;
  read?: AbortController;
  mutation?: AbortController;
}

export function useLinkedPlatforms({api, scope, platform, authenticate, fixture}: LinkedPlatformOptions) {
  const [snapshot, setSnapshot] = useState<{api: PlatformsApi; scope: AccountScope; value: LinkedPlatform[]}>();
  const [error, setError] = useState<AppMessageKey>();
  const [busy, setBusy] = useState<LoginProvider | null>(null);
  const [emailFlow, setEmailFlow] = useState<{current(): boolean} | null>(null);
  const lifetime = useRef<Lifetime | null>(null);
  const platforms = snapshot?.scope === scope && snapshot.api === api ? snapshot.value : null;

  useFocusEffect(useCallback(() => {
    setError(undefined);
    setBusy(null);
    setEmailFlow(null);
    if (fixture || !scope.isCurrent()) return;

    const generation: Lifetime = {current: () => lifetime.current === generation && scope.isCurrent(), refresh};
    lifetime.current = generation;
    async function refresh() {
      if (!generation.current() || generation.mutation) return;
      generation.read?.abort();
      const read = new AbortController();
      generation.read = read;
      try {
        const value = await api.getLinkedPlatforms(read.signal);
        if (generation.current() && !read.signal.aborted) {
          setSnapshot({api, scope, value});
          if (value.some(item => item.platform === 'mail')) setEmailFlow(null);
        }
      } catch {
        // Keep the last account-scoped platform list when a refresh is unavailable.
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

  function openEmail() {
    const generation = lifetime.current;
    if (!platforms || platforms.some(item => item.platform === 'mail') || !generation?.current() || generation.mutation) return;
    setError(undefined);
    setEmailFlow(generation);
  }

  function emailLinked() {
    const generation = lifetime.current;
    if (!generation || emailFlow !== generation || !generation.current()) return;
    generation.read?.abort();
    setEmailFlow(null);
    void generation.refresh();
  }

  async function linkProvider(type: LoginProvider) {
    const generation = lifetime.current;
    if (type === 'apple' && platform === 'android') return;
    if (!platforms || platforms.some(item => item.platform === type) || emailFlow || !generation?.current() || generation.mutation) return;
    const mutation = new AbortController();
    generation.mutation = mutation;
    const current = () => generation.current() && !mutation.signal.aborted;
    generation.read?.abort();
    setError(undefined);
    setBusy(type);
    let linked = false;
    try {
      const {state, nonce} = await api.startProviderLink({type, platform}, mutation.signal);
      if (!current()) return;
      const credential = await authenticate(type, nonce);
      if (!credential || !current()) return;
      await api.finishProviderLink({...credential, state, type, platform}, mutation.signal);
      linked = current();
    } catch (reason) {
      if (current()) setError(emailAuthError(reason) ?? 'email_auth_link_failed');
    } finally {
      generation.mutation = undefined;
      if (current()) {
        setBusy(null);
        if (linked) void generation.refresh();
      }
    }
  }

  return {platforms, error, busy, emailFlow, openEmail, emailLinked, closeEmail: () => setEmailFlow(null), linkProvider};
}
