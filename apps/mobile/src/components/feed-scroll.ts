import {useCallback, useLayoutEffect, useMemo, useRef} from 'react';
import type {NativeScrollEvent, NativeSyntheticEvent} from 'react-native';

/** Survives the source's separate Inbox/RSS composition lifetimes. */
export class FeedScrollPosition {
  offset = 0;
  source: string | null | undefined;
  select(source: string | null) {
    if (this.source !== undefined && this.source !== source) this.offset = 0;
    this.source = source;
  }
  reset() {this.offset = 0;}
}

export function useFeedScrollPosition(position: FeedScrollPosition, scrollTo: (offset: number, animated?: boolean) => void, active = true, scope?: string | null) {
  const pending = useRef(position.offset > 0), content = useRef(0), viewport = useRef(0), requested = useRef<number | null>(null);
  const lifetime = useMemo(() => ({active, position, scrollTo}), [active, position, scrollTo, scope]), currentLifetime = useRef<typeof lifetime | null>(null);
  const isCurrent = useCallback(() => lifetime.active && currentLifetime.current === lifetime, [lifetime]);
  useLayoutEffect(() => {
    currentLifetime.current = lifetime;
    if (active) {pending.current = position.offset > 0; content.current = 0; viewport.current = 0; requested.current = null;}
    return () => {if (currentLifetime.current === lifetime) currentLifetime.current = null;};
  }, [lifetime, position]);
  const attempt = useCallback((atEnd = false) => {
    if (!isCurrent() || !pending.current || viewport.current <= 0 || content.current <= 0) return;
    const maximum = Math.max(0, content.current - viewport.current);
    // Initial virtualization/layout can expose a shorter provisional document.
    // Only a real end-of-list observation can clamp a saved offset downward.
    if (maximum < position.offset && !atEnd) return;
    const target = Math.min(position.offset, maximum);
    if (requested.current === target) return;
    requested.current = target;
    scrollTo(target);
  }, [isCurrent, position, scrollTo]);
  const reset = useCallback((animated = false) => {
    const current = currentLifetime.current;
    if (!current || current.position !== position || current.scrollTo !== scrollTo) return;
    position.reset(); pending.current = true; requested.current = 0;
    if (current.active) scrollTo(0, animated);
  }, [position, scrollTo]);
  const events = useMemo(() => ({
    onLayout: (event: {nativeEvent: {layout: {height: number}}}) => {if (isCurrent()) {viewport.current = event.nativeEvent.layout.height; attempt();}},
    onContentSizeChange: (_width: number, height: number) => {
      if (!isCurrent()) return;
      const previous = content.current; content.current = height;
      if (!pending.current && previous > height && viewport.current > 0) position.offset = Math.min(position.offset, Math.max(0, height - viewport.current));
      attempt();
    },
    onEndReached: ({distanceFromEnd}: {distanceFromEnd: number}) => {if (distanceFromEnd <= 0) attempt(true);},
    onScrollBeginDrag: () => {if (isCurrent()) {pending.current = false; requested.current = null;}},
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!isCurrent()) return;
      const native = event.nativeEvent;
      const height = native.contentSize?.height ?? content.current, visibleHeight = native.layoutMeasurement?.height ?? viewport.current;
      const maximum = height > 0 && visibleHeight > 0 ? Math.max(0, height - visibleHeight) : Infinity;
      const value = Math.min(maximum, Math.max(0, native.contentOffset.y));
      if (pending.current) {
        if (requested.current === null || Math.abs(value - requested.current) > 0.5) return;
        pending.current = false;
      }
      position.offset = value;
    },
    scrollEventThrottle: 16,
    onEndReachedThreshold: 0,
  }), [isCurrent, attempt, position]);
  return {reset, events};
}
