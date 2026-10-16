import {useCallback, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {useMobile} from '../runtime';

export function usePdfLab() {
  const {api, runtime, nativeResourceOwner} = useMobile();
  const [state, setState] = useState({enabled: false, ready: false, busy: false, failed: false});
  const request = useRef<AbortController | null>(null);
  const focused = useRef(false);
  const observed = useRef<{api: typeof api; runtime: typeof runtime; owner: string | null} | null>(null);
  const load = useCallback(async (enabled?: boolean) => {
    if (request.current || !focused.current || !nativeResourceOwner || runtime.getNativeResourceOwner() !== nativeResourceOwner) return;
    const controller = new AbortController(); request.current = controller;
    const active = () => focused.current && request.current === controller && !controller.signal.aborted && runtime.getNativeResourceOwner() === nativeResourceOwner;
    setState(value => ({...value, busy: true, failed: false}));
    try {
      if (enabled !== undefined) await api.setLab('pdf', enabled, controller.signal);
      const result = await api.rssLabs(controller.signal);
      if (active()) setState({enabled: result.features.some(feature => feature.key === 'pdf' && feature.enabled), ready: true, busy: false, failed: false});
    } catch {
      if (active()) setState(value => ({...value, busy: false, failed: true}));
    } finally {if (request.current === controller) request.current = null;}
  }, [api, runtime, nativeResourceOwner]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    const previous = observed.current;
    if (!previous || previous.api !== api || previous.runtime !== runtime || previous.owner !== nativeResourceOwner) {
      observed.current = {api, runtime, owner: nativeResourceOwner};
      setState({enabled: false, ready: false, busy: false, failed: false});
    }
    void load();
    return () => {focused.current = false; request.current?.abort(); request.current = null;};
  }, [api, runtime, nativeResourceOwner, load]));
  return {...state, load};
}
