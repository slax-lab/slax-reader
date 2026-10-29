import React, {useCallback, useEffect, useRef, useState} from 'react';
import {FlatList, Platform, type FlatListProps} from 'react-native';

export type FeedScrollSample = {nativeEvent: {contentOffset: {x: number; y: number}; contentSize: {width: number; height: number}; layoutMeasurement: {width: number; height: number}}};
type FeedListProps<T> = Omit<FlatListProps<T>, 'onScroll' | 'onScrollBeginDrag' | 'onScrollEndDrag' | 'onMomentumScrollBegin' | 'onMomentumScrollEnd' | 'scrollEventThrottle' | 'maintainVisibleContentPosition' | 'windowSize' | 'maxToRenderPerBatch' | 'removeClippedSubviews' | 'scrollsToTop' | 'CellRendererComponent'> & {
  ref?: React.Ref<FlatList<T>>;
  /** Only the visible feed answers the iOS status-bar scroll-to-top gesture. */
  active?: boolean;
  onScroll?(event: FeedScrollSample): void; onScrollBeginDrag?(): void; onScrollEndDrag?(event: FeedScrollSample): void; onMomentumScrollBegin?(): void; onMomentumScrollEnd?(event: FeedScrollSample): void;
  /** True throughout a held drag, then until momentum ends or the released list reaches its idle window. */
  onScrollActivity?(scrolling: boolean): void;
  /** Identifies the content set (e.g. RSS source, Library list). A change replaces the data in place without a scroll-to-top animation. */
  contentScope?: string | null;
};

/** Coarse JS sampling while moving; drag/momentum end always reach JS with the resting offset. */
export const feedScrollInterval = 48;
const scrollIdle = 250;
/** Prepends keep the first visible row in place; a list resting at the top follows new rows to the top. */
const visiblePosition = {minIndexForVisible: 0, autoscrollToTopThreshold: 1};
/** Longest a content-scope switch keeps visible-position adjustment off while its replacement data loads. */
export const contentScopeSettle = 1000;

/** A plain native FlatList: no per-cell animated wrapper and no UI-thread scroll worklet (nothing is scroll-driven). */
export function FeedList<T>({ref, active = true, onScroll, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, onScrollActivity, contentScope, ...props}: FeedListProps<T>) {
  // A replaced content set is not a prepend: visible-position adjustment stays off until the replacement has rendered,
  // otherwise the native list animates back to the top (autoscrollToTopThreshold) or anchors to a row of the old set.
  // `from` is the data still shown when the scope switched; a replacement that arrived in the same render settles by the timeout.
  const [scope, setScope] = useState(contentScope), [replacing, setReplacing] = useState<{from: unknown} | null>(null);
  if (scope !== contentScope) {setScope(contentScope); setReplacing({from: props.data});}
  useEffect(() => {
    if (!replacing) return;
    const timer = setTimeout(() => setReplacing(null), contentScopeSettle);
    const rows = props.data as ArrayLike<unknown> | null | undefined;
    if (props.data === replacing.from || !rows?.length) return () => clearTimeout(timer);
    // One frame after the replacement commit, so the native list has applied the new rows first.
    const frame = setTimeout(() => setReplacing(null), 16);
    return () => {clearTimeout(timer); clearTimeout(frame);};
  }, [replacing, props.data]);
  const activity = useRef(onScrollActivity); activity.current = onScrollActivity;
  const mounted = useRef(true), busy = useRef(false), dragging = useRef(false), idle = useRef<ReturnType<typeof setTimeout> | null>(null), lastScroll = useRef(-Infinity);
  const setBusy = useCallback((next: boolean) => {
    if (idle.current) {clearTimeout(idle.current); idle.current = null;}
    if (busy.current === next) return;
    busy.current = next; activity.current?.(next);
  }, []);
  const settleLater = useCallback(() => {
    if (!busy.current || dragging.current) return;
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {idle.current = null; if (!dragging.current) setBusy(false);}, scrollIdle);
  }, [setBusy]);
  useEffect(() => {mounted.current = true; return () => {dragging.current = false; setBusy(false); mounted.current = false;};}, [setBusy]);
  useEffect(() => {if (!active) {dragging.current = false; setBusy(false);}}, [active, setBusy]);
  // Handlers close over this render's callbacks, so an event already in flight keeps the callbacks of its own feed lifetime.
  const beginDrag = useCallback(() => {if (mounted.current) {dragging.current = true; setBusy(true); onScrollBeginDrag?.();}}, [onScrollBeginDrag, setBusy]);
  const scroll = useCallback((event: FeedScrollSample) => {
    if (!mounted.current) return;
    settleLater();
    const now = Date.now();
    if (now - lastScroll.current < feedScrollInterval) return;
    lastScroll.current = now; onScroll?.(event);
  }, [onScroll, settleLater]);
  const endDrag = useCallback((event: FeedScrollSample) => {if (mounted.current) {dragging.current = false; settleLater(); onScrollEndDrag?.(event);}}, [onScrollEndDrag, settleLater]);
  const momentumBegin = useCallback(() => {if (mounted.current) {setBusy(true); onMomentumScrollBegin?.();}}, [onMomentumScrollBegin, setBusy]);
  const momentumEnd = useCallback((event: FeedScrollSample) => {if (mounted.current) {if (!dragging.current) setBusy(false); onMomentumScrollEnd?.(event);}}, [onMomentumScrollEnd, setBusy]);
  return <FlatList<T> ref={ref} {...props} onScroll={scroll} onScrollBeginDrag={beginDrag} onScrollEndDrag={endDrag} onMomentumScrollBegin={momentumBegin} onMomentumScrollEnd={momentumEnd} scrollEventThrottle={feedScrollInterval}
    maintainVisibleContentPosition={replacing ? undefined : visiblePosition} windowSize={9} maxToRenderPerBatch={Platform.OS === 'ios' ? 5 : 1}
    // iOS keeps clipping off: RN's own default, and detached image rows there can come back blank.
    removeClippedSubviews={Platform.OS === 'android'} scrollsToTop={active} />;
}
