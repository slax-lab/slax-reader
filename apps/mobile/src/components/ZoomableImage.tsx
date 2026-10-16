import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue} from 'react-native-reanimated';
import {AppImage, type DecodedImageRetention} from './AppImage';

function clamp(value: number, limit: number) {'worklet'; return Math.max(-limit, Math.min(limit, value));}
function bound(size: number, viewport: number, scale: number) {'worklet'; return Math.max(0, (size * scale - viewport) / 2);}
/** One gesture moves at most one page from where it began; the outer ends resist instead of sliding past the strip. */
function pagerBound(value: number, origin: number, count: number, width: number) {
  'worklet';
  const lower = Math.max(0, origin - 1) * width, upper = Math.min(count - 1, origin + 1) * width;
  if (value < lower) return lower - Math.min(width, (lower - value) * (origin === 0 ? 0.2 : 0));
  if (value > upper) return upper + Math.min(width, (value - upper) * (origin === count - 1 ? 0.2 : 0));
  return value;
}
/** Displacement and projected fling select the neighbour; velocity is in offset units (opposite to the finger). */
function pagerTarget(offset: number, velocity: number, origin: number, count: number, width: number) {
  'worklet';
  const displacement = offset - origin * width, travel = displacement + velocity * 0.18;
  const delta = Math.abs(displacement) > width * 0.25 || Math.abs(travel) > width * 0.4 ? (travel > 0 ? 1 : -1) : 0;
  return Math.max(0, Math.min(count - 1, origin + delta));
}
const pageSpring = {stiffness: 420, damping: 42, mass: 1, overshootClamping: true, reduceMotion: ReduceMotion.System} as const;

export interface ZoomableImageProps {
  uri: string | null;
  identity: string;
  width: number;
  height: number;
  active: boolean;
  /** Absolute pager position in points (page × width), owned by the UI runtime. */
  pageOffset: SharedValue<number>;
  page: number;
  pageCount: number;
  /** Receives the settled absolute page; repeated pages are idempotent. */
  onPage(page: number): void;
  onDismiss(): void;
  onLoad?(): void;
  onError?(): void;
  /** Long press on the resting active page opens image actions (save/share). */
  onLongPress?(): void;
  retention?: DecodedImageRetention;
  children?: React.ReactNode;
}

export function ZoomableImage({uri, identity, width, height, active, pageOffset, page, pageCount, onPage, onDismiss, onLoad, onError, onLongPress, retention, children}: ZoomableImageProps) {
  const scale = useSharedValue(1), x = useSharedValue(0), y = useSharedValue(0);
  const fitWidth = useSharedValue(width), fitHeight = useSharedValue(height);
  const startX = useSharedValue(0), startY = useSharedValue(0), startPage = useSharedValue(0), originPage = useSharedValue(page);
  const pinchScale = useSharedValue(1), pinchX = useSharedValue(0), pinchY = useSharedValue(0), focalX = useSharedValue(0), focalY = useSharedValue(0);
  const pinching = useSharedValue(false), blockedPan = useSharedValue(false), blockedPinch = useSharedValue(false), tracking = useSharedValue(false);
  const reset = useCallback(() => {
    cancelAnimation(scale); cancelAnimation(x); cancelAnimation(y);
    scale.value = 1; x.value = 0; y.value = 0;
  }, [scale, x, y]);
  const intrinsic = useRef<{identity: string; width: number; height: number} | null>(null);
  useEffect(() => {reset(); return reset;}, [identity, width, height, active, reset]);
  const fit = useCallback((size: {width: number; height: number}) => {
    const ratio = Math.min(width / Math.max(1, size.width), height / Math.max(1, size.height));
    fitWidth.value = size.width * ratio; fitHeight.value = size.height * ratio;
  }, [width, height, fitWidth, fitHeight]);
  useEffect(() => {fit(intrinsic.current?.identity === identity ? intrinsic.current : {width, height});}, [identity, width, height, fit]);
  const loaded = useCallback((size: {width: number; height: number}) => {
    intrinsic.current = {...size, identity}; fit(size); onLoad?.();
  }, [identity, fit, onLoad]);
  const gesture = useMemo(() => {
    const settle = (target: number, velocity: number) => {
      'worklet';
      pageOffset.value = withSpring(target * width, {...pageSpring, velocity}, finished => {
        if (!finished) return;
        // This page has left the viewport; fitted state is restored before it can be seen again.
        if (target !== page) {cancelAnimation(scale); cancelAnimation(x); cancelAnimation(y); scale.value = 1; x.value = 0; y.value = 0;}
        runOnJS(onPage)(target);
      });
    };
    const pinch = Gesture.Pinch().enabled(active && !!uri)
      .onStart(event => {
        // Only a page resting in the viewport can zoom; a page mid-transition keeps settling.
        blockedPinch.value = Math.abs(pageOffset.value - page * width) > width * 0.02;
        if (blockedPinch.value) return;
        pinching.value = true;
        if (pageOffset.value !== page * width) {cancelAnimation(pageOffset); pageOffset.value = page * width; runOnJS(onPage)(page);}
        cancelAnimation(scale); cancelAnimation(x); cancelAnimation(y);
        pinchScale.value = scale.value; pinchX.value = x.value; pinchY.value = y.value;
        focalX.value = event.focalX - width / 2; focalY.value = event.focalY - height / 2;
      })
      .onUpdate(event => {
        if (blockedPinch.value) return;
        const next = Math.max(1, Math.min(5, pinchScale.value * event.scale)), ratio = next / pinchScale.value;
        scale.value = next;
        x.value = clamp(event.focalX - width / 2 - (focalX.value - pinchX.value) * ratio, bound(fitWidth.value, width, next));
        y.value = clamp(event.focalY - height / 2 - (focalY.value - pinchY.value) * ratio, bound(fitHeight.value, height, next));
      })
      .onFinalize(() => {pinching.value = false; blockedPinch.value = false;});
    // Every mounted page can begin a swipe, so a second swipe lands even before JS commits the first.
    const pan = Gesture.Pan().enabled(true).minDistance(5).maxPointers(1)
      .onBegin(() => {
        tracking.value = true; cancelAnimation(pageOffset);
        originPage.value = Math.max(0, Math.min(pageCount - 1, Math.round(pageOffset.value / Math.max(1, width))));
      })
      .onStart(() => {
        tracking.value = true; cancelAnimation(pageOffset); cancelAnimation(x); cancelAnimation(y); cancelAnimation(scale);
        startX.value = x.value; startY.value = y.value; startPage.value = pageOffset.value;
        originPage.value = Math.max(0, Math.min(pageCount - 1, Math.round(pageOffset.value / Math.max(1, width))));
        blockedPan.value = pinching.value;
      })
      .onUpdate(event => {
        if (pinching.value || event.numberOfPointers > 1) {blockedPan.value = true; return;}
        if (blockedPan.value) return;
        const maxX = bound(fitWidth.value, width, scale.value), maxY = bound(fitHeight.value, height, scale.value);
        const desired = startX.value + event.translationX, nextX = clamp(desired, maxX);
        x.value = nextX; y.value = clamp(startY.value + event.translationY, maxY);
        const horizontal = Math.abs(event.translationX) > Math.abs(event.translationY);
        pageOffset.value = pagerBound(startPage.value - (horizontal ? desired - nextX : 0), originPage.value, pageCount, width);
      })
      .onEnd((event, succeeded) => {
        if (!succeeded || blockedPan.value || pinching.value) return;
        tracking.value = false;
        // The pager is engaged only while it is away from the page the gesture began on; panning inside a zoomed image never flips pages.
        const engaged = pageOffset.value !== originPage.value * width;
        settle(engaged ? pagerTarget(pageOffset.value, -event.velocityX, originPage.value, pageCount, width) : originPage.value, engaged ? -event.velocityX : 0);
      })
      .onFinalize(() => {
        if (tracking.value && pageOffset.value !== originPage.value * width) settle(originPage.value, 0);
        tracking.value = false; blockedPan.value = false;
      });
    const doubleTap = Gesture.Tap().enabled(active && !!uri).numberOfTaps(2).maxDelay(280).onEnd((event, succeeded) => {
      if (!succeeded || Math.abs(pageOffset.value - page * width) > width * 0.02) return;
      if (pageOffset.value !== page * width) {cancelAnimation(pageOffset); pageOffset.value = page * width; runOnJS(onPage)(page);}
      cancelAnimation(scale); cancelAnimation(x); cancelAnimation(y);
      const next = scale.value > 1.01 ? 1 : 2.5, ratio = next / scale.value;
      x.value = withTiming(clamp((event.x - width / 2) * (1 - ratio) + x.value * ratio, bound(fitWidth.value, width, next)), {duration: 220, reduceMotion: ReduceMotion.System});
      y.value = withTiming(clamp((event.y - height / 2) * (1 - ratio) + y.value * ratio, bound(fitHeight.value, height, next)), {duration: 220, reduceMotion: ReduceMotion.System});
      scale.value = withTiming(next, {duration: 220, reduceMotion: ReduceMotion.System});
    });
    const tap = Gesture.Tap().enabled(active).maxDistance(8).onEnd((_event, succeeded) => {if (succeeded) runOnJS(onDismiss)();});
    if (!onLongPress) return Gesture.Race(Gesture.Simultaneous(pinch, pan), Gesture.Exclusive(doubleTap, tap));
    const longPress = Gesture.LongPress().enabled(active && !!uri).minDuration(450).maxDistance(10).onStart(() => {
      if (!pinching.value && Math.abs(pageOffset.value - page * width) <= width * 0.02) runOnJS(onLongPress)();
    });
    return Gesture.Race(Gesture.Simultaneous(pinch, pan), longPress, Gesture.Exclusive(doubleTap, tap));
  }, [active, uri, width, height, page, pageCount, onPage, onDismiss, onLongPress, pageOffset, scale, x, y, startX, startY, startPage, originPage, fitWidth, fitHeight, pinchScale, pinchX, pinchY, focalX, focalY, pinching, blockedPan, blockedPinch, tracking]);
  const style = useAnimatedStyle(() => ({transform: [{translateX: x.value}, {translateY: y.value}, {scale: scale.value}]}));
  return <GestureDetector gesture={gesture}><View collapsable={false} style={{width, height, overflow: 'hidden'}}>
    {uri ? <Animated.View style={[StyleSheet.absoluteFill, style]}><AppImage source={uri} identity={identity} fit="contain" maxPixels={4 * 1024 * 1024} active={active} retention={retention} transition={0} style={StyleSheet.absoluteFill} onLoad={loaded} onError={onError} /></Animated.View> : null}
    {children}
  </View></GestureDetector>;
}
