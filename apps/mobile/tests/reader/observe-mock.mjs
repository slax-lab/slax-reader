import React from 'react';
import * as readiness from '../../src/observe/readiness.ts';
import {createInteractiveSignal} from '../../src/observe/interactive.ts';

export {readiness};

export function observeBoundaries(boundaries = {}) {
  const NavigationContainer = boundaries['@react-navigation/native']?.NavigationContainer;
  const Container = NavigationContainer ?? React.forwardRef((props, ref) => React.createElement('div', {...props, ref}));
  const ObserveNavigationContainer = React.forwardRef((props, ref) => React.createElement(Container, {...props, ref}));
  const observe = {
    ObserveRoot: {wrap: component => component},
    ObserveNavigationContainer,
    useObserveMarkInteractive: () => () => {},
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
    '../observe/readiness': readiness,
    ...defaults,
  };
}

/**
 * Loads the real src/observe module against a counting SDK stub, so screen tests
 * exercise the production once-per-mount and failure-containment logic.
 */
export async function countingObserve(load) {
  const counter = {marks: 0};
  const sdk = {
    Observe: {configure() {}},
    ObserveRoot: {wrap: component => component},
    useObserve: () => ({markInteractive() {counter.marks++;}}),
  };
  const module = await load('../../src/observe/index.ts', {
    react: React,
    '@react-navigation/native': {NavigationContainer: () => null},
    'expo-observe': sdk,
    'expo-observe/integrations/react-navigation': {ObserveNavigationContainer: () => null},
    './readiness': readiness,
    './interactive': {firstInteractive: createInteractiveSignal()},
  });
  return {module, counter};
}
