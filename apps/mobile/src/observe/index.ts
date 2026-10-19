import React, {useCallback, useRef} from 'react';
import {NavigationContainer} from '@react-navigation/native';

type ObserveSdk = {
  Observe: {configure(config: unknown): void};
  ObserveRoot: {wrap(component: React.ComponentType<any>): React.ComponentType<any>};
  useObserve(): {markInteractive(): void};
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

class ObserveBoundary extends React.Component<{fallback: React.ComponentType<any>; fallbackProps: any; children?: React.ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    return this.state.failed ? React.createElement(this.props.fallback, this.props.fallbackProps) : this.props.children;
  }
}

const noop = () => {};
const useNoopObserve = () => ({markInteractive: noop});
const useSdkObserve = observe?.useObserve ?? useNoopObserve;

export function useObserveMarkInteractive() {
  const {markInteractive} = useSdkObserve();
  const latest = useRef(markInteractive);
  latest.current = markInteractive;
  return useCallback(() => {
    try { latest.current(); } catch {}
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

export const libraryIsInteractive = (rowsReady: boolean, error: unknown) => rowsReady || Boolean(error);
export const libraryRecoveryVisible = (dataReady: boolean, upgradeStatus: string) => !dataReady && (upgradeStatus === 'error' || upgradeStatus === 'verification-required');
export const readerIsInteractive = (documentReady: boolean, contentError: unknown, rssError: unknown, nativeFailure: unknown) =>
  documentReady || Boolean(contentError) || Boolean(rssError) || Boolean(nativeFailure);
