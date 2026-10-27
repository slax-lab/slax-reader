import {useSyncExternalStore} from 'react';
import {AppState} from 'react-native';

const listeners = new Set<() => void>();
let subscription: {remove(): void} | null = null;
/** KMP lifecycle: only `background` pauses; transient `inactive` (Control Center, app switcher) stays foreground. */
function foreground() {return AppState.currentState !== 'background';}
function subscribe(listener: () => void) {
  listeners.add(listener);
  subscription ??= AppState.addEventListener('change', () => listeners.forEach(notify => notify()));
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {subscription?.remove(); subscription = null;}
  };
}

export function useAppForeground(): boolean {
  return useSyncExternalStore(subscribe, foreground, foreground);
}
