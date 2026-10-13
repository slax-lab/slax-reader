import React, {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import {Platform, StyleSheet, View} from 'react-native';
import type {ViewProps, NativeSyntheticEvent} from 'react-native';
import {requireNativeViewManager} from 'expo-modules-core';
import type {WebView, WebViewProps} from 'react-native-webview';
import type {ReaderNativeAdapter, ReaderNativeContext, ReaderNativeOverlayProps} from '../reader/native';

const NativeOverlay = Platform.OS === 'ios' ? requireNativeViewManager<ReaderNativeOverlayProps>('SlaxPlatform', 'SlaxReaderOverlayView') : undefined;

interface NativeReaderRef {
  injectJavaScript(script: string): Promise<void>;
  evaluateJavaScript(script: string, pageId: string): Promise<unknown>;
  stopLoading(): Promise<void>;
  scrollTo(y: number, animated: boolean): Promise<void>;
  updateInsets(top: number, bottom: number): Promise<void>;
  setScrollsToTop(enabled: boolean): Promise<void>;
  detach(): Promise<void>;
}
interface NativeReaderEvent {type: string; target: number; pageId: string; data?: string; screenY?: number; y?: number; contentHeight?: number; viewportHeight?: number; viewportWidth?: number; url?: string; message?: string; code?: string}
interface NativeReaderProps extends ViewProps {
  html: string; baseUrl?: string; cacheKey: string; pageId: string; scrollsToTop: boolean;
  cacheDirectory?: string;
  pdfMode: boolean;
  scrollEnabled: boolean;
  protectedHosts: string[];
  imageProxyOrigins: string[];
  resourceOwner: string | null;
  onEvent(event: NativeSyntheticEvent<NativeReaderEvent>): void;
  ref?: React.Ref<NativeReaderRef>;
}
const NativeView = requireNativeViewManager<NativeReaderProps>('SlaxPlatform', 'SlaxReaderView');
const refs = new Map<number, NativeReaderRef>();
const touchListeners = new Map<number, Set<(screenY: number) => void>>();
function view(id: number) { const ref = refs.get(id); if (!ref) throw new Error('Reader page is no longer attached'); return ref; }

const NativeReaderHost = forwardRef<WebView, WebViewProps>(function NativeReaderHost(props, outerRef) {
  const nativeRef = useRef<NativeReaderRef|null>(null);
  const attachedRef = useRef<NativeReaderRef|null>(null);
  const identity = useRef<number|null>(null);
  const disposed = useRef(false);
  const callbacks = useRef(props); callbacks.current = props;
  const nativeProps = props.nativeConfig?.props as unknown as ReaderNativeContext;
  useImperativeHandle(outerRef, () => ({
    injectJavaScript: (script: string) => {void nativeRef.current?.injectJavaScript(script).catch(() => undefined);},
    evaluateJavaScript: async (script: string, pageId: string) => {
      if (!nativeRef.current) throw new Error('Reader native view is unavailable');
      try {return await nativeRef.current.evaluateJavaScript(script, pageId);}
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error) {
          if (error.code === 'E_READER_PROCESS_GONE') {const gone = new Error('Reader document process was interrupted'); gone.name = 'ReaderProcessGone'; throw gone;}
          if (error.code === 'E_READER_INACTIVE' || error.code === 'E_READER_RELEASED') {const cancelled = new Error('Reader operation cancelled'); cancelled.name = 'ReaderOperationCancelled'; throw cancelled;}
        }
        throw error;
      }
    },
    stopLoading: () => {void nativeRef.current?.stopLoading().catch(() => undefined);},
  } as unknown as WebView), []);
  useEffect(() => () => {
    disposed.current = true;
    if (identity.current !== null) { refs.delete(identity.current); touchListeners.delete(identity.current); }
    const previous = attachedRef.current;
    nativeRef.current = null; attachedRef.current = null; identity.current = null;
    void previous?.detach().catch(() => undefined);
  }, []);
  const source = props.source as {html?: string; baseUrl?: string} | undefined;
  function receive(incoming: NativeSyntheticEvent<NativeReaderEvent>) {
    const event = incoming.nativeEvent;
    if (disposed.current || event.pageId !== nativeProps.pageId) return;
    identity.current = event.target;
    if (nativeRef.current) refs.set(event.target, nativeRef.current);
    const navigation = {target: event.target, url: event.url ?? source?.baseUrl ?? 'about:blank', title: '', loading: event.type === 'loadStart', canGoBack: false, canGoForward: false, navigationType: 'other' as const, lockIdentifier: 0};
    if (event.type === 'loadStart') callbacks.current.onLoadStart?.({...incoming, nativeEvent: navigation});
    else if (event.type === 'loadEnd') callbacks.current.onLoadEnd?.({...incoming, nativeEvent: navigation});
    else if (event.type === 'message') callbacks.current.onMessage?.({...incoming, nativeEvent: {...navigation, data: event.data ?? ''}});
    else if (event.type === 'touch' && event.screenY !== undefined) touchListeners.get(event.target)?.forEach(callback => callback(event.screenY!));
    else if (event.type === 'scroll') callbacks.current.onScroll?.({nativeEvent: {contentOffset: {x: 0, y: event.y ?? 0}, contentSize: {width: event.viewportWidth ?? 0, height: event.contentHeight ?? 0}, layoutMeasurement: {width: event.viewportWidth ?? 0, height: event.viewportHeight ?? 0}, contentInset: {top: 0, bottom: 0, left: 0, right: 0}, zoomScale: 1}} as Parameters<NonNullable<WebViewProps['onScroll']>>[0]);
    else if (event.type === 'external' && event.url) callbacks.current.onShouldStartLoadWithRequest?.({...navigation, url: event.url, navigationType: 'click', isTopFrame: true, mainDocumentURL: source?.baseUrl ?? '', lockIdentifier: 0});
    else if (event.type === 'error') callbacks.current.onError?.({...incoming, nativeEvent: {...navigation, code: event.code === 'renderProcessGone' ? -1001 : -1, domain: 'SlaxReader', description: event.message ?? 'Reader document failed'}});
  }
  return <View style={[styles.document, props.containerStyle]}><NativeView ref={instance => { nativeRef.current = instance; if (instance) attachedRef.current = instance; }}
    style={[styles.document, props.style]} testID={props.testID} html={source?.html ?? ''} baseUrl={source?.baseUrl}
    pdfMode={nativeProps.pdfMode === true} scrollEnabled={props.scrollEnabled !== false} protectedHosts={nativeProps.protectedHosts} imageProxyOrigins={nativeProps.imageProxyOrigins} cacheKey={nativeProps.cacheKey} cacheDirectory={nativeProps.cacheDirectory} resourceOwner={nativeProps.resourceOwner ?? null} pageId={nativeProps.pageId} scrollsToTop={nativeProps.scrollsToTop} onEvent={receive}/></View>;
});
export const readerNativeAdapter: ReaderNativeAdapter = {
  HostComponent: NativeReaderHost,
  OverlayComponent: NativeOverlay,
  nativeConfig: context => ({props: context}),
  attach: (id, context) => view(id).setScrollsToTop(context.scrollsToTop),
  subscribeTouch(id, callback) { let listeners = touchListeners.get(id); if (!listeners) { listeners = new Set(); touchListeners.set(id, listeners); } listeners.add(callback); return () => { listeners?.delete(callback); }; },
  setScrollsToTop: (id, enabled) => view(id).setScrollsToTop(enabled),
  scrollTo: (id, y, animated) => view(id).scrollTo(y, animated),
  updateInsets: (id, top, bottom) => view(id).updateInsets(top, bottom),
  async detach(id) { const previous = refs.get(id); refs.delete(id); touchListeners.delete(id); await previous?.detach(); },
};
const styles = StyleSheet.create({document: {flex: 1, backgroundColor: 'transparent'}});
