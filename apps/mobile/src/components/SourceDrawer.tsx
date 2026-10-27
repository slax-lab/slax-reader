import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, Platform, Pressable, StyleSheet, type ViewProps} from 'react-native';
import {GestureDetector, usePanGesture} from 'react-native-gesture-handler';
import Animated, {cancelAnimation, Easing, ReduceMotion, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {scheduleOnRN} from 'react-native-worklets';
import {useFocusEffect} from '@react-navigation/native';
import {motionDuration} from '../motion/policy';
import {drawerDestination, drawerPanConfig, drawerProgress} from './drawer-motion';

const android = Platform.OS === 'android';

/** One UI-thread pan: leading-edge hit slop while closed, the whole surface while open. */
export function SourceDrawer({open, onOpenChange, width, drawer, children, testID}: {
  open: boolean; onOpenChange(open: boolean): void; width: number;
  drawer: React.ReactNode; children: React.ReactNode; testID?: string;
}) {
  const progress = useSharedValue(open ? 1 : 0), start = useSharedValue(0), dragging = useSharedValue(false), target = useSharedValue(open);
  const [surfaceOpen, setSurfaceOpen] = useState(open), mounted = useRef(true);
  const current = useRef(onOpenChange); current.current = onOpenChange;
  const published = useRef(open), pending = useRef<boolean | null>(null), scheduled = useRef(false);
  const publish = useCallback(() => {
    scheduled.current = false;
    const next = pending.current;
    pending.current = null;
    if (next === null || !mounted.current) return;
    setSurfaceOpen(next);
    if (published.current === next) return;
    published.current = next;
    current.current(next);
  }, []);
  const commit = useCallback((next: boolean) => {
    pending.current = next;
    if (scheduled.current) return;
    scheduled.current = true;
    void Promise.resolve().then(publish);
  }, [publish]);
  const settle = useCallback((next: boolean) => {
    'worklet';
    target.value = next;
    cancelAnimation(progress);
    progress.value = withTiming(next ? 1 : 0, {duration: motionDuration.drawer, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.System});
  }, [progress, target]);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; pending.current = null; cancelAnimation(progress);};}, [progress]);
  useEffect(() => {
    setSurfaceOpen(open);
    if (published.current === open) return;
    pending.current = null;
    published.current = open;
    settle(open);
  }, [open, settle]);
  const dismiss = useCallback(() => {
    pending.current = null; published.current = false;
    setSurfaceOpen(false); settle(false);
    current.current(false);
  }, [settle]);
  useFocusEffect(useCallback(() => {
    if (!surfaceOpen) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {dismiss(); return true;});
    return () => listener.remove();
  }, [surfaceOpen, dismiss]));
  const pan = usePanGesture(useMemo(() => ({
    ...drawerPanConfig(Platform.OS, surfaceOpen),
    onActivate: () => {'worklet'; cancelAnimation(progress); start.value = progress.value; dragging.value = true;},
    onUpdate: (event: {translationX: number}) => {'worklet'; progress.value = drawerProgress(start.value, event.translationX, width);},
    onDeactivate: (event: {velocityX: number; canceled: boolean}) => {
      'worklet';
      dragging.value = false;
      const next = event.canceled ? target.value : drawerDestination(progress.value, event.velocityX);
      settle(next);
      scheduleOnRN(commit, next);
    },
  }), [surfaceOpen, width, progress, start, dragging, target, settle, commit]));
  const scrimProps = useAnimatedProps<ViewProps>(() => ({pointerEvents: dragging.value || target.value ? 'auto' : 'none'}));
  const contentProps = useAnimatedProps<ViewProps>(() => {
    const hidden = dragging.value || target.value;
    return android ? {importantForAccessibility: hidden ? 'no-hide-descendants' : 'auto'} : {accessibilityElementsHidden: hidden};
  });
  const drawerProps = useAnimatedProps<ViewProps>(() => {
    const hidden = !dragging.value && !target.value;
    return android ? {importantForAccessibility: hidden ? 'no-hide-descendants' : 'auto'} : {accessibilityElementsHidden: hidden};
  });
  const scrimStyle = useAnimatedStyle(() => ({opacity: progress.value}));
  const drawerStyle = useAnimatedStyle(() => ({transform: [{translateX: (progress.value - 1) * width}]}));
  return <GestureDetector gesture={pan}><Animated.View style={styles.fill}>
    <Animated.View style={styles.fill} animatedProps={contentProps}>{children}</Animated.View>
    <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} animatedProps={scrimProps}>
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={dismiss} />
    </Animated.View>
    <Animated.View testID={testID} animatedProps={drawerProps} onAccessibilityEscape={dismiss} style={[{position: 'absolute', top: 0, bottom: 0, left: 0, width}, drawerStyle]}>{drawer}</Animated.View>
  </Animated.View></GestureDetector>;
}
const styles = StyleSheet.create({fill: {flex: 1}, scrim: {backgroundColor: 'rgba(0, 0, 0, 0.32)'}});
