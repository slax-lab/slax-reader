import {useCallback, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import type {PasskeyInfo} from '@slax-reader/contracts/passkey';
import type {SlaxApi} from '../data/api';
import type {AppMessageKey} from '../i18n';
import {registerPasskey, type NativePasskeys} from '../auth/passkeys';
import type {AccountScope} from './account-scope';

type PasskeysApi = Pick<SlaxApi, 'getPasskeys' | 'getPasskeyRegistrationChallenge' | 'registerPasskey' | 'deletePasskey'>;
interface Lifetime {current(): boolean; read?: AbortController; mutation?: AbortController; refresh(): Promise<void>}

export function usePasskeys({api, scope, native, enabled, hasMailbox, name}: {
  api: PasskeysApi; scope: AccountScope; native: NativePasskeys; enabled: boolean; hasMailbox: boolean; name: string;
}) {
  const [snapshot, setSnapshot] = useState<{api: PasskeysApi; scope: AccountScope; value: PasskeyInfo[]}>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AppMessageKey>();
  const lifetime = useRef<Lifetime | null>(null);
  const passkeys = snapshot?.api === api && snapshot.scope === scope ? snapshot.value : null;
  useFocusEffect(useCallback(() => {
    setBusy(null); setError(undefined);
    if (!enabled || !scope.isCurrent()) return;
    const generation: Lifetime = {current: () => lifetime.current === generation && scope.isCurrent(), refresh};
    lifetime.current = generation;
    async function refresh() {
      if (!generation.current() || generation.mutation) return;
      generation.read?.abort();
      const read = new AbortController(); generation.read = read;
      try {
        const value = await api.getPasskeys(read.signal);
        if (generation.current() && !read.signal.aborted) setSnapshot({api, scope, value});
      } catch {if (generation.current() && !read.signal.aborted) setError('passkey_load_failed');}
      finally {if (generation.read === read) generation.read = undefined;}
    }
    void refresh();
    return () => {lifetime.current = null; generation.read?.abort(); generation.mutation?.abort();};
  }, [api, scope, enabled]));

  async function mutate(uuid?: string) {
    const generation = lifetime.current;
    if (!enabled || !generation?.current() || generation.mutation || (!uuid && !hasMailbox)) return;
    const request = new AbortController(); generation.mutation = request;
    const current = () => generation.current() && !request.signal.aborted;
    generation.read?.abort(); setBusy(uuid ?? 'create'); setError(undefined);
    let changed = false;
    try {
      if (uuid) {await api.deletePasskey(uuid, request.signal); changed = current();}
      else changed = await registerPasskey({api, native, name, signal: request.signal, isCurrent: current});
    } catch {if (current()) setError('passkey_action_failed');}
    finally {
      generation.mutation = undefined;
      if (current()) {setBusy(null); if (changed) void generation.refresh();}
    }
  }
  return {enabled, passkeys, busy, error, create: () => {void mutate();}, remove: (uuid: string) => {void mutate(uuid);}, reload: () => {void lifetime.current?.refresh();}};
}
