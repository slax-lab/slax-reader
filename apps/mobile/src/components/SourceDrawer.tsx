import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, Platform, Pressable, StyleSheet, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import type {SharedValue} from 'react-native-reanimated';
import Animated, {cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {useFocusEffect} from '@react-navigation/native';
import {motionDuration} from '../motion/policy';

const touchSlop = Platform.OS === 'ios' ? 10 : 8;
type PanGesture = ReturnType<typeof Gesture.Pan>;
const DrawerInput = createContext<SharedValue<boolean> | null>(null);
export function useDrawerInput() {return useContext(DrawerInput);}
export function DrawerScrollBoundary({children}: {children: React.ReactElement}) {
  const opening = useDrawerGesture();
  const native = useMemo(() => {const gesture = Gesture.Native(); return opening ? gesture.requireExternalGestureToFail(opening) : gesture;}, [opening]);
  return <GestureDetector gesture={native}>{children}</GestureDetector>;
}
const DrawerGesture = createContext<PanGesture | null>(null);
export function useDrawerGesture() {return useContext(DrawerGesture);}

export function SourceDrawer({open, onOpenChange, width, drawer, children, testID, onInteractionChange}: {
  open: boolean; onOpenChange(open: boolean): void; width: number;
  drawer: React.ReactNode; children: React.ReactNode; testID?: string; onInteractionChange?(locked: boolean): void;
}) {
  const motion = useSharedValue(open ? 1 : 0), start = useSharedValue(0), dragging = useSharedValue(false), committed = useSharedValue(open);
  const generation = useSharedValue(0), locked = useSharedValue(open);
  const interaction = useRef(onInteractionChange); interaction.current = onInteractionChange;
  const [visible, setVisible] = useState(open), mounted = useRef(true);
  const current = useRef({open, onOpenChange}); current.current = {open, onOpenChange};
  const show = useCallback((next: boolean, owner: number) => {
    if (!mounted.current || generation.value !== owner || (!next && committed.value)) return;
    locked.value = next; setVisible(next); interaction.current?.(next);
  }, [generation, committed]);
  const commit = useCallback((next: boolean, owner: number) => {
    if (!mounted.current || committed.value !== next || generation.value !== owner) return;
    if (next) setVisible(true);
    current.current.onOpenChange(next);
  }, [committed, generation]);
  const settle = useCallback((next: boolean) => {
    'worklet';
    locked.value = true;
    const owner = ++generation.value;
    cancelAnimation(motion);
    motion.value = withTiming(next ? 1 : 0, {duration: motionDuration.drawer, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.System}, finished => {
      if (finished && !next && generation.value === owner) runOnJS(show)(false, owner);
    });
  }, [motion, generation, show, locked]);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; generation.value++; cancelAnimation(motion);};}, [motion, generation]);
  useEffect(() => {
    if (committed.value === open) return;
    committed.value = open;
    if (open) {locked.value = true; setVisible(true); interaction.current?.(true);}
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
    .onStart(() => {locked.value = true; generation.value++; cancelAnimation(motion); start.value = motion.value; dragging.value = true; runOnJS(show)(true, generation.value);})
    .onUpdate(event => {motion.value = Math.max(0, Math.min(1, start.value + event.translationX / Math.max(1, width)));})
    .onEnd((event, succeeded) => {
      if (!succeeded) return;
      const next = Math.abs(event.velocityX) >= 400 ? event.velocityX > 0 : motion.value >= 0.5;
      const changed = next !== committed.value;
      committed.value = next; dragging.value = false; settle(next);
      if (changed) runOnJS(commit)(next, generation.value);
    })
    .onFinalize((_event, succeeded) => {if (dragging.value && !succeeded) settle(committed.value); dragging.value = false;}), [motion, start, dragging, committed, width, show, commit, settle, generation, locked]);
  const opening = useMemo(() => makeGesture(false), [makeGesture]);
  const closing = useMemo(() => makeGesture(true), [makeGesture]);
  opening.enabled(!open);
  closing.enabled(open || visible);
  const scrimStyle = useAnimatedStyle(() => ({opacity: motion.value}));
  const drawerStyle = useAnimatedStyle(() => ({transform: [{translateX: (motion.value - 1) * width}]}));
  return <DrawerInput.Provider value={locked}><DrawerGesture.Provider value={opening}><View style={{flex: 1}}>
    <GestureDetector gesture={opening}><View collapsable={false} style={{flex: 1}} pointerEvents={visible || open ? 'none' : 'auto'} importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={visible}>{children}</View></GestureDetector>
    <GestureDetector gesture={closing}><View collapsable={false} pointerEvents={visible || open ? 'auto' : 'none'} style={StyleSheet.absoluteFill} accessibilityViewIsModal={visible} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} onAccessibilityEscape={dismiss}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {backgroundColor: 'rgba(0, 0, 0, 0.32)'}, scrimStyle]} />
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={dismiss} />
      <Animated.View testID={testID} style={[{width, height: '100%'}, drawerStyle]}>{drawer}</Animated.View>
    </View></GestureDetector>
  </View></DrawerGesture.Provider></DrawerInput.Provider>;
}
