import {useCallback, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {SlaxApi} from '../data/api';
import type {AccountScope} from './account-scope';

export interface LabState {
  enabled: boolean;
  ready: boolean;
  busy: boolean;
  failed: boolean;
  load(enabled?: boolean): Promise<void>;
}

const initial = {enabled: false, ready: false, busy: false, failed: false};

export function useRssLab(api: Pick<SlaxApi, 'rssLabs' | 'rssEnable'>, scope: AccountScope): LabState {
  const [state, setState] = useState(initial);
  const request = useRef<AbortController | null>(null);
  const foreground = useRef(false);
  const observedScope = useRef<AccountScope | null>(null);
  const load = useCallback(async (enabled?: boolean) => {
    if (request.current || !foreground.current || !scope.isCurrent()) return;
    const controller = new AbortController();
    request.current = controller;
    const active = () => request.current === controller && !controller.signal.aborted
      && foreground.current && scope.isCurrent();
    setState(value => ({...value, busy: true, failed: false}));
    try {
      let value: boolean;
      if (enabled === undefined) {
        const response = await api.rssLabs(controller.signal);
        value = response.features.some(feature => feature.key === 'rss' && feature.enabled);
      } else {
        await api.rssEnable(enabled, controller.signal);
        value = enabled;
      }
      if (active()) setState({enabled: value, ready: true, busy: false, failed: false});
    } catch {
      if (active()) setState(value => ({...value, busy: false, failed: true}));
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [api, scope]);

  useFocusEffect(useCallback(() => {
    const cancel = () => {
      foreground.current = false;
      request.current?.abort();
      request.current = null;
    };
    const update = (status: string) => {
      if (status !== 'active') {
        cancel();
        setState(value => ({...value, busy: false}));
      } else if (!foreground.current) {
        foreground.current = true;
        void load();
      }
    };
    if (observedScope.current !== scope) {observedScope.current = scope; setState(initial);}
    update(AppState.currentState);
    const subscription = AppState.addEventListener('change', update);
    return () => {
      cancel();
      subscription.remove();
    };
  }, [load]));

  return {...state, load};
}
