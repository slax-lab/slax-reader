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
  const published = useRef(open), interacting = useRef(open), pending = useRef<boolean | null>(null), scheduled = useRef(false);
  const show = useCallback((next: boolean, owner: number) => {
    if (!mounted.current || generation.value !== owner) return;
    locked.value = next;
    setVisible(next);
  }, [generation, locked]);
  const publish = useCallback(() => {
    scheduled.current = false;
    const next = pending.current;
    pending.current = null;
    if (next === null || !mounted.current || published.current === next) return;
    published.current = next;
    if (next) setVisible(true);
    current.current.onOpenChange(next);
  }, []);
  const commit = useCallback((next: boolean) => {
    pending.current = next;
    if (scheduled.current) return;
    scheduled.current = true;
    void Promise.resolve().then(publish);
  }, [publish]);
  const settle = useCallback((next: boolean) => {
    'worklet';
    locked.value = true;
    const owner = ++generation.value;
    cancelAnimation(motion);
    motion.value = withTiming(next ? 1 : 0, {duration: motionDuration.drawer, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.System}, finished => {
      if (finished && !next && generation.value === owner) runOnJS(show)(false, owner);
    });
  }, [motion, generation, show, locked]);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; pending.current = null; generation.value++; cancelAnimation(motion);};}, [motion, generation]);
  useEffect(() => {
    if (published.current === open) return;
    pending.current = null;
    published.current = open;
    committed.value = open;
    if (open) setVisible(true);
    settle(open);
  }, [open, published, committed, settle]);
  useEffect(() => {
    locked.value = visible;
    if (interacting.current === visible) return;
    interacting.current = visible;
    interaction.current?.(visible);
  }, [visible, locked]);
  const dismiss = useCallback(() => {
    pending.current = null; committed.value = false; published.current = false;
    settle(false);
    current.current.onOpenChange(false);
  }, [committed, settle]);
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
      committed.value = next; dragging.value = false; settle(next);
      runOnJS(commit)(next);
    })
    .onFinalize((_event, succeeded) => {
      if (dragging.value && !succeeded) {
        const resolved = committed.value;
        settle(resolved);
        runOnJS(commit)(resolved);
      }
      dragging.value = false;
    }), [motion, start, dragging, committed, width, show, commit, settle, generation, locked]);
  const opening = useMemo(() => makeGesture(false), [makeGesture]);
  const closing = useMemo(() => makeGesture(true), [makeGesture]);
  opening.enabled(!open || !visible);
  closing.enabled(open || visible);
  const scrimStyle = useAnimatedStyle(() => ({opacity: motion.value}));
  const drawerStyle = useAnimatedStyle(() => ({transform: [{translateX: (motion.value - 1) * width}]}));
  return <DrawerInput.Provider value={locked}><DrawerGesture.Provider value={opening}><View style={{flex: 1}}>
    <GestureDetector gesture={opening}><View collapsable={false} style={{flex: 1}} pointerEvents={visible ? 'none' : 'auto'} importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={visible}>{children}</View></GestureDetector>
    <GestureDetector gesture={closing}><View collapsable={false} pointerEvents={visible ? 'auto' : 'none'} style={StyleSheet.absoluteFill} accessibilityViewIsModal={visible} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} onAccessibilityEscape={dismiss}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {backgroundColor: 'rgba(0, 0, 0, 0.32)'}, scrimStyle]} />
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={dismiss} />
      <Animated.View testID={testID} style={[{width, height: '100%'}, drawerStyle]}>{drawer}</Animated.View>
    </View></GestureDetector>
  </View></DrawerGesture.Provider></DrawerInput.Provider>;
}
