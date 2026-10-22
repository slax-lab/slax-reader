import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {Gesture, GestureDetector, GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {cancelAnimation, ReduceMotion, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {mobileColors as C} from '../theme';

export function SheetBody({visible, busy, onDismiss, children, style, contentContainerStyle, bottomPadding, handleColor}: {
  visible: boolean; busy?: boolean; onDismiss(): void; children: React.ReactNode;
  style?: StyleProp<ViewStyle>; contentContainerStyle?: StyleProp<ViewStyle>; bottomPadding: number; handleColor?: string;
}) {
  const inset = useSafeAreaInsets();
  const drag = useSharedValue(0), height = useSharedValue(1), scroll = useSharedValue(0), start = useSharedValue(0);
  const touchX = useSharedValue(0), touchY = useSharedValue(0), generation = useSharedValue(0), dragging = useSharedValue(false);
  const life = useRef({visible, busy, onDismiss, alive: true}); life.current = {...life.current, visible, busy, onDismiss};
  const dismiss = useCallback((owner: number) => {
    if (life.current.alive && life.current.visible && !life.current.busy && generation.value === owner) life.current.onDismiss();
  }, [generation]);
  useEffect(() => {
    life.current.alive = true; generation.value++; cancelAnimation(drag);
    if (visible) drag.value = 0;
    return () => {life.current.alive = false; generation.value++; cancelAnimation(drag);};
  }, [visible, busy, drag, generation]);
  const native = useMemo(() => Gesture.Native(), []);
  const createPan = useCallback((content: boolean) => Gesture.Pan().enabled(visible && !busy).manualActivation(true)
    .onTouchesDown(event => {dragging.value = false; const touch = event.allTouches[0]; if (touch) {touchX.value = touch.absoluteX; touchY.value = touch.absoluteY;}})
    .onTouchesMove((event, manager) => {
      if (dragging.value) return;
      const touch = event.allTouches[0]; if (!touch) return;
      const dx = touch.absoluteX - touchX.value, dy = touch.absoluteY - touchY.value;
      if (Math.abs(dx) > 8 && Math.abs(dx) >= Math.abs(dy) || dy < -8 || content && scroll.value > 0) {manager.fail(); return;}
      if (dy > 8 && dy > Math.abs(dx)) manager.activate();
    })
    .onStart(() => {dragging.value = true; generation.value++; cancelAnimation(drag); start.value = drag.value;})
    .onUpdate(event => {drag.value = Math.max(0, Math.min(height.value, start.value + event.translationY));})
    .onEnd((event, succeeded) => {
      if (!succeeded) return;
      const close = drag.value > Math.min(140, height.value * 0.25) || event.velocityY > 900 && drag.value > 16;
      if (close) runOnJS(dismiss)(generation.value);
      else drag.value = withTiming(0, {duration: 180, reduceMotion: ReduceMotion.System});
    })
    .onFinalize((_event, succeeded) => {dragging.value = false; if (!succeeded) drag.value = withTiming(0, {duration: 180, reduceMotion: ReduceMotion.System});}),
  [visible, busy, drag, height, scroll, start, touchX, touchY, generation, dragging, dismiss]);
  const handle = useMemo(() => createPan(false), [createPan]);
  const content = useMemo(() => createPan(true).simultaneousWithExternalGesture(native), [createPan, native]);
  const onScroll = useAnimatedScrollHandler(event => {scroll.value = Math.max(0, event.contentOffset.y);});
  const moving = useAnimatedStyle(() => ({transform: [{translateY: drag.value}]}));
  return <GestureHandlerRootView style={{flexShrink: 1}}><Animated.View accessibilityViewIsModal
    onLayout={event => {height.value = event.nativeEvent.layout.height;}}
    style={[styles.sheet, style, {paddingBottom: inset.bottom + bottomPadding}, moving]}>
    <GestureDetector gesture={handle}><View collapsable={false} style={{alignSelf: 'stretch'}}><View style={[styles.handle, handleColor ? {backgroundColor: handleColor} : undefined]} /></View></GestureDetector>
    <GestureDetector gesture={content}><Animated.View style={{flexShrink: 1}} collapsable={false}>
      <GestureDetector gesture={native}><Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[{gap: 16}, contentContainerStyle]}>{children}</Animated.ScrollView></GestureDetector>
    </Animated.View></GestureDetector>
  </Animated.View></GestureHandlerRootView>;
}
const styles = StyleSheet.create({sheet: {maxHeight: '92%', paddingHorizontal: 24, backgroundColor: C.readerBackground, borderTopLeftRadius: 24, borderTopRightRadius: 24}, handle: {alignSelf: 'center', backgroundColor: '#79747E', height: 4, width: 32, borderRadius: 2, marginVertical: 22}});
