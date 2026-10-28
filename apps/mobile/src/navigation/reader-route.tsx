import React, {useEffect} from 'react';
import type {NativeStackNavigationOptions} from '@react-navigation/native-stack';
import {ReaderHeaderSlot} from '../reader/components/ReaderHeaderSlot';
import type {RootStackParams} from './types';

const headerSlot = () => <ReaderHeaderSlot />;
/**
 * The Reader's first native header configuration is final: transparent from the first frame, with a same-size right item
 * for bookmarks that the screen later fills in place. RSS previews have no right item. iOS 26 adds no scroll-edge blur band.
 */
export function readerScreenOptions({route}: {route: {params?: RootStackParams['Reader']}}): NativeStackNavigationOptions {
  const preview = Boolean(route.params?.rssEntryId);
  return {
    title: '', headerTransparent: true, headerShadowVisible: false, headerStyle: {backgroundColor: 'transparent'},
    scrollEdgeEffects: {top: 'hidden', bottom: 'hidden', left: 'hidden', right: 'hidden'},
    headerRight: preview ? undefined : headerSlot,
    unstable_headerRightItems: preview ? undefined : () => [{type: 'custom', element: headerSlot(), hidesSharedBackground: true}],
  };
}

type Schedule = (work: () => void) => () => void;
interface PresentationSource {isLibraryPresented(): boolean; subscribeLibraryPresented(listener: () => void): () => void}
const idle: Schedule = work => {
  const host = globalThis as typeof globalThis & {requestIdleCallback?: (callback: () => void, options: {timeout: number}) => number; cancelIdleCallback?: (id: number) => void};
  if (typeof host.requestIdleCallback === 'function' && typeof host.cancelIdleCallback === 'function') {
    const id = host.requestIdleCallback(work, {timeout: 2000});
    return () => host.cancelIdleCallback?.(id);
  }
  const id = setTimeout(work, 0);
  return () => clearTimeout(id);
};

/** Loads the Reader module and warms the native document host once per process, at idle after the Library is presented. */
export function createReaderPrewarm({load, prewarm, schedule = idle}: {load(): unknown; prewarm(): Promise<void>; schedule?: Schedule}) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    try {load();} catch {}
    void prewarm().catch(() => undefined);
  };
  return {
    run,
    afterLibrary(source: PresentationSource): () => void {
      let cancel: (() => void) | undefined;
      const check = () => {if (!done && !cancel && source.isLibraryPresented()) cancel = schedule(() => {cancel = undefined; run();});};
      const stop = source.subscribeLibraryPresented(check);
      check();
      return () => {stop(); cancel?.(); cancel = undefined;};
    },
  };
}

/** Evaluates the same module App.tsx registers for the Reader route, so the first push does not pay for its initialization. */
const loadReaderModule = () => require('../screens/ReaderScreen');
const readerPrewarm = createReaderPrewarm({load: loadReaderModule, prewarm: () => (require('../native/reader-prewarm') as typeof import('../native/reader-prewarm')).prewarmReaderHost()});
export const preloadReader = readerPrewarm.run;
export function useReaderPrewarm(source: PresentationSource | undefined) {
  useEffect(() => source ? readerPrewarm.afterLibrary(source) : undefined, [source]);
}
