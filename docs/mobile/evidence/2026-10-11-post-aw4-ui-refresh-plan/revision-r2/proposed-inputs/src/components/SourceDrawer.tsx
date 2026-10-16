import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Animated, BackHandler, Platform, Pressable, StyleSheet, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {useFocusEffect} from '@react-navigation/native';
import {drawerDestination, drawerProgress} from './drawer-motion';

const touchSlop = Platform.OS === 'ios' ? 10 : 8;

export function SourceDrawer({open, onOpenChange, width, drawer, children, testID}: {
  open: boolean; onOpenChange(open: boolean): void; width: number;
  drawer: React.ReactNode; children: React.ReactNode; testID?: string;
}) {
  const motion = useRef(new Animated.Value(open ? 1 : 0)).current;
  const progress = useRef(open ? 1 : 0), start = useRef(0), destination = useRef(open), mounted = useRef(true), dragging = useRef(false);
  const [visible, setVisible] = useState(open);
  useEffect(() => {
    mounted.current = true;
    const listener = motion.addListener(({value}) => {progress.current = value;});
    return () => {mounted.current = false; motion.stopAnimation(); motion.removeListener(listener);};
  }, [motion]);
  const settle = useCallback((next: boolean) => {
    destination.current = next;
    if (next) setVisible(true);
    Animated.timing(motion, {toValue: next ? 1 : 0, duration: 300, useNativeDriver: true}).start(({finished}) => {
      if (finished && mounted.current && !destination.current) setVisible(false);
    });
  }, [motion]);
  useEffect(() => {settle(open);}, [open, settle]);
  useFocusEffect(useCallback(() => {
    if (!visible) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {onOpenChange(false); settle(false); return true;});
    return () => listener.remove();
  }, [visible, onOpenChange, settle]));
  const makeGesture = useCallback((closing: boolean) => Gesture.Pan().runOnJS(true)
    .activeOffsetX(closing ? -touchSlop : touchSlop).failOffsetX(closing ? touchSlop : -touchSlop).failOffsetY([-touchSlop, touchSlop])
    .onStart(() => {motion.stopAnimation(); start.current = progress.current; dragging.current = true; setVisible(true);})
    .onUpdate(event => {const value = drawerProgress(start.current, event.translationX, width); progress.current = value; motion.setValue(value);})
    .onEnd((event, succeeded) => {
      if (!succeeded) return;
      const next = drawerDestination(progress.current, event.velocityX);
      dragging.current = false; settle(next); if (next !== open) onOpenChange(next);
    })
    .onFinalize((_event, succeeded) => {if (dragging.current && !succeeded) settle(open); dragging.current = false;}), [motion, width, open, onOpenChange, settle]);
  const opening = useMemo(() => makeGesture(false).enabled(!open), [makeGesture, open]);
  const closing = useMemo(() => makeGesture(true).enabled(open), [makeGesture, open]);
  return <View style={{flex: 1}}>
    <GestureDetector gesture={opening}><View collapsable={false} style={{flex: 1}} importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={visible}>{children}</View></GestureDetector>
    {visible ? <GestureDetector gesture={closing}><View collapsable={false} style={StyleSheet.absoluteFill} accessibilityViewIsModal onAccessibilityEscape={() => {onOpenChange(false); settle(false);}}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {opacity: motion, backgroundColor: 'rgba(0, 0, 0, 0.32)'}]} />
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => {onOpenChange(false); settle(false);}} />
      <Animated.View testID={testID} style={{width, height: '100%', transform: [{translateX: motion.interpolate({inputRange: [0, 1], outputRange: [-width, 0]})}]}}>{drawer}</Animated.View>
    </View></GestureDetector> : null}
  </View>;
}
