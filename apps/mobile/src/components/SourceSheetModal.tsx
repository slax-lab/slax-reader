import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, type ViewStyle} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {mobileColors} from '../theme';
import {motionDuration, motionDurationFor} from '../motion/policy';
import {useReducedMotion} from '../motion/useReducedMotion';

export function SourceSheetModal({visible, onDismiss, onDidDismiss, dismissible = true, maxHeight, children}: {
  visible: boolean; onDismiss(): void; onDidDismiss?(): void; dismissible?: boolean; maxHeight?: ViewStyle['maxHeight']; children: React.ReactNode;
}) {
  const {height: windowHeight} = useWindowDimensions();
  const [presented, setPresented] = useState(visible), [shown, setShown] = useState(false), [height, setHeight] = useState(0);
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const current = useRef({visible, onDidDismiss, generation: 0});
  const generation = current.current.generation + (!current.current.visible && visible ? 1 : 0);
  current.current = {visible, onDidDismiss, generation};
  const pendingDismiss = useRef(false), retained = useRef(children), mounted = useRef(true);
  if (visible) retained.current = children;
  useEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false; pendingDismiss.current = false;};
  }, []);
  const completeDismissal = () => {
    if (!mounted.current || current.current.generation !== generation || current.current.visible || !pendingDismiss.current) return;
    pendingDismiss.current = false;
    current.current.onDidDismiss?.();
  };
  useEffect(() => {
    if (visible) {
      pendingDismiss.current = false;
      if (!presented) {setHeight(0); setShown(false); setPresented(true); return;}
      if (!shown || height <= 0) return;
    } else if (!presented) return;
    let active = true;
    const animation = Animated.timing(progress, {toValue: visible ? 1 : 0, duration: motionDurationFor(visible ? motionDuration.sheetEnter : motionDuration.sheetExit, reducedMotion), easing: Easing.out(Easing.cubic), useNativeDriver: true});
    animation.start(({finished}) => {
      if (!active || !finished || visible || current.current.visible) return;
      pendingDismiss.current = true;
      setShown(false); setPresented(false);
      if (Platform.OS !== 'ios') completeDismissal();
    });
    return () => {active = false; animation.stop();};
  }, [visible, presented, shown, height, reducedMotion, progress]);
  return <Modal visible={presented} transparent presentationStyle="overFullScreen" animationType="none" statusBarTranslucent
    onShow={() => setShown(true)} onDismiss={completeDismissal} onRequestClose={() => {if (dismissible) onDismiss();}}>
    <SafeAreaProvider>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View testID="source-sheet-backdrop" style={[StyleSheet.absoluteFill, {backgroundColor: mobileColors.scrim, opacity: progress}]}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => {if (dismissible) onDismiss();}} />
      </Animated.View>
      <SafeAreaView edges={['left', 'right']} style={{flexShrink: 1, maxHeight}} pointerEvents="box-none">
      <Animated.View testID="source-sheet-content" accessibilityViewIsModal onLayout={event => setHeight(previous => previous === event.nativeEvent.layout.height ? previous : event.nativeEvent.layout.height)}
        style={{maxHeight: '100%', opacity: reducedMotion ? progress : 1, transform: [{translateY: progress.interpolate({inputRange: [0, 1], outputRange: [reducedMotion ? 0 : height || windowHeight, 0]})}]}}>
        {visible ? children : retained.current}
      </Animated.View>
      </SafeAreaView>
    </KeyboardAvoidingView>
    </SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({root: {flex: 1, justifyContent: 'flex-end'}});
