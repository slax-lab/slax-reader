import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue} from 'react-native-reanimated';
import {AppImage} from './AppImage';

function clamp(value: number, limit: number) {'worklet'; return Math.max(-limit, Math.min(limit, value));}
function bound(size: number, viewport: number, scale: number) {'worklet'; return Math.max(0, (size * scale - viewport) / 2);}

export interface ZoomableImageProps {
  uri: string | null;
  identity: string;
  width: number;
  height: number;
  active: boolean;
  pageOffset: SharedValue<number>;
  pageGeneration: SharedValue<number>;
  canPrevious: boolean;
  canNext: boolean;
  onPage(displacement: number, velocity: number, generation: number): void;
  onDismiss(): void;
  onLoad?(): void;
  onError?(): void;
  children?: React.ReactNode;
}

export function ZoomableImage({uri, identity, width, height, active, pageOffset, pageGeneration, canPrevious, canNext, onPage, onDismiss, onLoad, onError, children}: ZoomableImageProps) {
  const scale = useSharedValue(1), x = useSharedValue(0), y = useSharedValue(0);
  const fitWidth = useSharedValue(width), fitHeight = useSharedValue(height);
  const startX = useSharedValue(0), startY = useSharedValue(0), startPage = useSharedValue(0);
  const pinchScale = useSharedValue(1), pinchX = useSharedValue(0), pinchY = useSharedValue(0), focalX = useSharedValue(0), focalY = useSharedValue(0);
  const pinching = useSharedValue(false), handoff = useSharedValue(false), blockedPan = useSharedValue(false);
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
    const pinch = Gesture.Pinch().enabled(active && !!uri)
      .onStart(event => {
        pinching.value = true; pageGeneration.value++; cancelAnimation(pageOffset); pageOffset.value = 0;
        cancelAnimation(scale); cancelAnimation(x); cancelAnimation(y);
        pinchScale.value = scale.value; pinchX.value = x.value; pinchY.value = y.value;
        focalX.value = event.focalX - width / 2; focalY.value = event.focalY - height / 2;
      })
      .onUpdate(event => {
        const next = Math.max(1, Math.min(5, pinchScale.value * event.scale)), ratio = next / pinchScale.value;
        scale.value = next;
        x.value = clamp(event.focalX - width / 2 - (focalX.value - pinchX.value) * ratio, bound(fitWidth.value, width, next));
        y.value = clamp(event.focalY - height / 2 - (focalY.value - pinchY.value) * ratio, bound(fitHeight.value, height, next));
      })
      .onFinalize(() => {pinching.value = false;});
    const pan = Gesture.Pan().enabled(active).minDistance(5).maxPointers(1)
      .onStart(() => {
        pageGeneration.value++; cancelAnimation(pageOffset); cancelAnimation(x); cancelAnimation(y); cancelAnimation(scale);
        startX.value = x.value; startY.value = y.value; startPage.value = pageOffset.value;
        blockedPan.value = pinching.value; handoff.value = false;
      })
      .onUpdate(event => {
        if (pinching.value || event.numberOfPointers > 1) {blockedPan.value = true; return;}
        if (blockedPan.value) return;
        const maxX = bound(fitWidth.value, width, scale.value), maxY = bound(fitHeight.value, height, scale.value);
        const desired = startX.value + event.translationX, nextX = clamp(desired, maxX);
        const horizontal = Math.abs(event.translationX) > Math.abs(event.translationY);
        const excess = horizontal ? desired - nextX + startPage.value : 0;
        x.value = nextX; y.value = clamp(startY.value + event.translationY, maxY);
        handoff.value = Math.abs(excess) > 0;
        const permitted = excess > 0 ? canPrevious : canNext;
        pageOffset.value = clamp(excess * (permitted ? 1 : 0.2), width);
      })
      .onEnd((event, succeeded) => {
        if (!succeeded || blockedPan.value || pinching.value) return;
        if (handoff.value) {
          const target = pageOffset.value + event.velocityX * 0.18;
          const direction = Math.abs(pageOffset.value) > width * 0.25 || Math.abs(target) > width * 0.4 ? (target > 0 ? -1 : 1) : 0;
          const permitted = direction < 0 ? canPrevious : canNext;
          const destination = direction && permitted ? -direction * width : 0, generation = pageGeneration.value;
          pageOffset.value = withTiming(destination, {duration: 220, reduceMotion: ReduceMotion.System}, finished => {
            if (finished && pageGeneration.value === generation && destination !== 0) runOnJS(onPage)(destination, 0, generation);
          });
        }
      })
      .onFinalize((_event, succeeded) => {
        if (!succeeded || blockedPan.value) pageOffset.value = withTiming(0, {duration: 180, reduceMotion: ReduceMotion.System});
        blockedPan.value = false;
      });
    const doubleTap = Gesture.Tap().enabled(active && !!uri).numberOfTaps(2).maxDelay(280).onEnd((event, succeeded) => {
      if (!succeeded) return;
      pageGeneration.value++; cancelAnimation(pageOffset); pageOffset.value = 0;
      cancelAnimation(scale); cancelAnimation(x); cancelAnimation(y);
      const next = scale.value > 1.01 ? 1 : 2.5, ratio = next / scale.value;
      x.value = withTiming(clamp((event.x - width / 2) * (1 - ratio) + x.value * ratio, bound(fitWidth.value, width, next)), {duration: 220, reduceMotion: ReduceMotion.System});
      y.value = withTiming(clamp((event.y - height / 2) * (1 - ratio) + y.value * ratio, bound(fitHeight.value, height, next)), {duration: 220, reduceMotion: ReduceMotion.System});
      scale.value = withTiming(next, {duration: 220, reduceMotion: ReduceMotion.System});
    });
    const tap = Gesture.Tap().enabled(active).maxDistance(8).onEnd((_event, succeeded) => {if (succeeded) runOnJS(onDismiss)();});
    return Gesture.Race(Gesture.Simultaneous(pinch, pan), Gesture.Exclusive(doubleTap, tap));
  }, [active, uri, width, height, canPrevious, canNext, onPage, onDismiss, pageOffset, pageGeneration, scale, x, y, startX, startY, startPage, fitWidth, fitHeight, pinchScale, pinchX, pinchY, focalX, focalY, pinching, handoff, blockedPan]);
  const style = useAnimatedStyle(() => ({transform: [{translateX: x.value}, {translateY: y.value}, {scale: scale.value}]}));
  return <GestureDetector gesture={gesture}><View collapsable={false} style={{width, height, overflow: 'hidden'}}>
    {uri ? <Animated.View style={[StyleSheet.absoluteFill, style]}><AppImage source={uri} identity={identity} fit="contain" maxPixels={4 * 1024 * 1024} active={active} transition={0} style={StyleSheet.absoluteFill} onLoad={loaded} onError={onError} /></Animated.View> : null}
    {children}
  </View></GestureDetector>;
}
