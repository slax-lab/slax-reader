import {createContext, useContext, useEffect, useState} from 'react';
import type {AvatarResources} from '../data/avatar-cache';
export const AvatarResourcesContext = createContext<AvatarResources | null>(null);
export function useAvatarResource(slot: string, url?: string) {
  const cache = useContext(AvatarResourcesContext);
  const [value, setValue] = useState<{cache: AvatarResources; slot: string; uri: string} | null>(null);
  useEffect(() => {
    if (!cache || !url) return;
    let active = true;
    const stop = cache.subscribe?.(() => {if (active) setValue(null);});
    void cache.resolve(slot, url, uri => {if (active) setValue({cache, slot, uri});}).catch(() => {});
    return () => {active = false; stop?.();};
  }, [cache, slot, url]);
  return value?.cache === cache && value.slot === slot ? value.uri : cache ? undefined : url;
}
