import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, Platform, Pressable, StyleSheet, View} from 'react-native';
import {Gesture, GestureDetector, type PanGesture} from 'react-native-gesture-handler';
import Animated, {cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {useFocusEffect} from '@react-navigation/native';
import {drawerSettleDuration} from '../motion/policy';

const touchSlop = Platform.OS === 'ios' ? 10 : 8;
const DrawerGesture = createContext<PanGesture | null>(null);
export function useDrawerGesture() {return useContext(DrawerGesture);}

export function SourceDrawer({open, onOpenChange, width, drawer, children, testID}: {
  open: boolean; onOpenChange(open: boolean): void; width: number;
  drawer: React.ReactNode; children: React.ReactNode; testID?: string;
}) {
  const motion = useSharedValue(open ? 1 : 0), start = useSharedValue(0), dragging = useSharedValue(false), committed = useSharedValue(open);
  const generation = useSharedValue(0);
  const [visible, setVisible] = useState(open), mounted = useRef(true);
  const current = useRef({open, onOpenChange}); current.current = {open, onOpenChange};
  const show = useCallback((next: boolean, owner: number) => {
    if (!mounted.current || generation.value !== owner || (!next && committed.value)) return;
    setVisible(next);
  }, [generation, committed]);
  const commit = useCallback((next: boolean, owner: number) => {
    if (!mounted.current || committed.value !== next || generation.value !== owner) return;
    if (next) setVisible(true);
    current.current.onOpenChange(next);
  }, [committed, generation]);
  const settle = useCallback((next: boolean) => {
    'worklet';
    const owner = ++generation.value;
    cancelAnimation(motion);
    // Emphasized decelerate: the panel leaves quickly and eases into place over only the remaining distance.
    motion.value = withTiming(next ? 1 : 0, {duration: drawerSettleDuration(motion.value, next ? 1 : 0), easing: Easing.bezier(0.05, 0.7, 0.1, 1), reduceMotion: ReduceMotion.System}, finished => {
      if (finished && !next && generation.value === owner) runOnJS(show)(false, owner);
    });
  }, [motion, generation, show]);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; generation.value++; cancelAnimation(motion);};}, [motion, generation]);
  useEffect(() => {
    if (committed.value === open) return;
    committed.value = open;
    if (open) setVisible(true);
    settle(open);
  }, [open, committed, settle]);
  const dismiss = useCallback(() => {committed.value = false; current.current.onOpenChange(false); settle(false);}, [committed, settle]);
  useFocusEffect(useCallback(() => {
    if (!visible) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {dismiss(); return true;});
    return () => listener.remove();
  }, [visible, dismiss]));
  const makeGesture = useCallback((closing: boolean) => Gesture.Pan()
    .activeOffsetX(closing ? [-touchSlop, touchSlop] : touchSlop).failOffsetX(closing ? Number.MAX_SAFE_INTEGER : -touchSlop).failOffsetY([-touchSlop, touchSlop])
    .onStart(() => {generation.value++; cancelAnimation(motion); start.value = motion.value; dragging.value = true; runOnJS(show)(true, generation.value);})
    .onUpdate(event => {motion.value = Math.max(0, Math.min(1, start.value + event.translationX / Math.max(1, width)));})
    .onEnd((event, succeeded) => {
      if (!succeeded) return;
      const next = Math.abs(event.velocityX) >= 400 ? event.velocityX > 0 : motion.value >= 0.5;
      const changed = next !== committed.value;
      committed.value = next; dragging.value = false; settle(next);
      if (changed) runOnJS(commit)(next, generation.value);
    })
    .onFinalize((_event, succeeded) => {if (dragging.value && !succeeded) settle(committed.value); dragging.value = false;}), [motion, start, dragging, committed, width, show, commit, settle, generation]);
  const opening = useMemo(() => makeGesture(false), [makeGesture]);
  const closing = useMemo(() => makeGesture(true), [makeGesture]);
  opening.enabled(!open);
  closing.enabled(open || visible);
  const scrimStyle = useAnimatedStyle(() => ({opacity: motion.value}));
  const drawerStyle = useAnimatedStyle(() => ({transform: [{translateX: (motion.value - 1) * width}]}));
  return <DrawerGesture.Provider value={opening}><View style={{flex: 1}}>
    <GestureDetector gesture={opening}><View collapsable={false} style={{flex: 1}} importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={visible}>{children}</View></GestureDetector>
    <GestureDetector gesture={closing}><View collapsable={false} pointerEvents={visible ? 'auto' : 'none'} style={StyleSheet.absoluteFill} accessibilityViewIsModal={visible} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} onAccessibilityEscape={dismiss}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {backgroundColor: 'rgba(0, 0, 0, 0.32)'}, scrimStyle]} />
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={dismiss} />
      <Animated.View testID={testID} style={[{width, height: '100%'}, drawerStyle]}>{drawer}</Animated.View>
    </View></GestureDetector>
  </View></DrawerGesture.Provider>;
}
