import React from 'react';

export function observeBoundaries(boundaries = {}) {
  const NavigationContainer = boundaries['@react-navigation/native']?.NavigationContainer;
  const Container = NavigationContainer ?? React.forwardRef((props, ref) => React.createElement('div', {...props, ref}));
  const ObserveNavigationContainer = React.forwardRef((props, ref) => React.createElement(Container, {...props, ref}));
  const observe = {
    ObserveRoot: {wrap: component => component},
    ObserveNavigationContainer,
    useObserveMarkInteractive: () => () => {},
    libraryIsInteractive: (rowsReady, error) => rowsReady || Boolean(error),
    libraryRecoveryVisible: (dataReady, upgradeStatus) => !dataReady && (upgradeStatus === 'error' || upgradeStatus === 'verification-required'),
    readerIsInteractive: (documentReady, contentError, rssError, nativeFailure) => documentReady || Boolean(contentError) || Boolean(rssError) || Boolean(nativeFailure),
    Observe: {configure() {}, markInteractive() {}, reportError() {}},
    useObserve: () => ({markInteractive() {}}),
  };
  return {
    'expo-observe': observe,
    'expo-observe/integrations/react-navigation': {ObserveNavigationContainer},
  };
}

export function observeRelativeBoundaries(boundaries = {}) {
  const defaults = observeBoundaries(boundaries);
  const observe = defaults['expo-observe'];
  return {
    './observe': observe,
    '../observe': observe,
    '../../observe': observe,
    ...defaults,
  };
}
