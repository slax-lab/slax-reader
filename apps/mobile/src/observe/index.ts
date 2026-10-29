import React, {useCallback, useRef} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {firstInteractive} from './interactive';

type ObserveSdk = {
  Observe: {configure(config: unknown): void};
  ObserveRoot: {wrap(component: React.ComponentType<any>): React.ComponentType<any>};
  useObserve(): {markInteractive(): unknown};
};
type NavigationSdk = {ObserveNavigationContainer: React.ComponentType<any>};

function loadObserve(): ObserveSdk | null {
  try { return require('expo-observe') as ObserveSdk; } catch { return null; }
}
function loadNavigation(): NavigationSdk | null {
  try { return require('expo-observe/integrations/react-navigation') as NavigationSdk; } catch { return null; }
}

const observe = loadObserve();
const navigation = loadNavigation();
const fixtureMode = typeof process !== 'undefined' && (Boolean(process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE) || process.env.EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE === '1');

const filteredParams = [
  'bookmarkId',
  'collectionOwnerId',
  'collectionId',
  'rssEntryId',
  'title',
  'targetUrl',
  'openedFrom',
  'entryPoint',
];

if (observe) {
  try {
    observe.Observe.configure({
      dispatchingEnabled: !fixtureMode,
      dispatchInDebug: false,
      integrations: {'react-navigation': {filteredParams}},
    });
  } catch {}
}

// Only errors raised by the Observe SDK fall back; app errors keep propagating to
// the real boundaries and crash reporting instead of being silently swallowed.
const isObserveError = (error: unknown) => typeof (error as {message?: unknown} | null)?.message === 'string' && (error as {message: string}).message.startsWith('[expo-observe]');

class ObserveBoundary extends React.Component<{fallback: React.ComponentType<any>; fallbackProps: any; children?: React.ReactNode}, {error: unknown; failed: boolean}> {
  state = {error: null as unknown, failed: false};
  static getDerivedStateFromError(error: unknown) { return {error, failed: isObserveError(error)}; }
  render() {
    if (this.state.failed) return React.createElement(this.props.fallback, this.props.fallbackProps);
    if (this.state.error) throw this.state.error;
    return this.props.children;
  }
}

const noop = () => {};
const useNoopObserve = () => ({markInteractive: noop});
const useSdkObserve = observe?.useObserve ?? useNoopObserve;

/** Marks the calling screen interactive at most once per mount; Observe failures never reach the caller. */
export function useObserveMarkInteractive() {
  const {markInteractive} = useSdkObserve();
  const latest = useRef(markInteractive);
  latest.current = markInteractive;
  const marked = useRef(false);
  return useCallback(() => {
    if (marked.current) return;
    marked.current = true;
    firstInteractive.mark();
    try {
      const result: unknown = latest.current();
      if (result && typeof (result as Promise<unknown>).then === 'function') (result as Promise<unknown>).catch(noop);
    } catch {}
  }, []);
}

export const ObserveRoot = {
  wrap: (Component: React.ComponentType<any>) => {
    if (!observe?.ObserveRoot?.wrap) return Component;
    let Wrapped = Component;
    try { Wrapped = observe.ObserveRoot.wrap(Component); } catch { return Component; }
    if (Wrapped === Component) return Component;
    return (props: any) => React.createElement(ObserveBoundary, {fallback: Component, fallbackProps: props}, React.createElement(Wrapped, props));
  },
};

const FallbackContainer = NavigationContainer as React.ComponentType<any>;

export const ObserveNavigationContainer = React.forwardRef((props: any, ref: any) => {
  const SdkContainer = navigation?.ObserveNavigationContainer;
  if (!SdkContainer) return React.createElement(FallbackContainer, {...props, ref});
  return React.createElement(
    ObserveBoundary,
    {fallback: FallbackContainer, fallbackProps: {...props, ref}},
    React.createElement(SdkContainer, {...props, ref}),
  );
});

export {libraryIsInteractive, libraryRecoveryVisible, readerIsInteractive} from './readiness';
