import React, {useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, useWindowDimensions} from 'react-native';
import {mobileColors} from '../theme';

export function SourceSheetModal({visible, onDismiss, onDidDismiss, dismissible = true, children}: {
  visible: boolean; onDismiss(): void; onDidDismiss?(): void; dismissible?: boolean; children: React.ReactNode;
}) {
  const {height: windowHeight} = useWindowDimensions();
  const [presented, setPresented] = useState(visible), [shown, setShown] = useState(false), [height, setHeight] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const current = useRef({visible, onDidDismiss}); current.current = {visible, onDidDismiss};
  const pendingDismiss = useRef(false), retained = useRef(children);
  if (visible) retained.current = children;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {if (active) setReducedMotion(value);});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => {active = false; subscription.remove();};
  }, []);
  const completeDismissal = () => {
    if (current.current.visible || !pendingDismiss.current) return;
    pendingDismiss.current = false;
    current.current.onDidDismiss?.();
  };
  useEffect(() => {
    if (visible) {
      pendingDismiss.current = false;
      if (!presented) {setHeight(0); setShown(false); setPresented(true); return;}
      if (!shown || height <= 0) return;
    } else if (!presented) return;
    const animation = Animated.timing(progress, {toValue: visible ? 1 : 0, duration: reducedMotion ? 0 : visible ? 220 : 160, easing: Easing.out(Easing.cubic), useNativeDriver: true});
    animation.start(({finished}) => {
      if (!finished || current.current.visible) return;
      pendingDismiss.current = true;
      setShown(false); setPresented(false);
      if (Platform.OS !== 'ios') completeDismissal();
    });
    return () => animation.stop();
  }, [visible, presented, shown, height, reducedMotion, progress]);
  return <Modal visible={presented} transparent presentationStyle="overFullScreen" animationType="none" statusBarTranslucent
    onShow={() => setShown(true)} onDismiss={completeDismissal} onRequestClose={() => {if (dismissible) onDismiss();}}>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View testID="source-sheet-backdrop" style={[StyleSheet.absoluteFill, {backgroundColor: mobileColors.scrim, opacity: progress}]}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => {if (dismissible) onDismiss();}} />
      </Animated.View>
      <Animated.View testID="source-sheet-content" accessibilityViewIsModal onLayout={event => setHeight(previous => previous === event.nativeEvent.layout.height ? previous : event.nativeEvent.layout.height)}
        style={{maxHeight: '100%', opacity: reducedMotion ? progress : 1, transform: [{translateY: progress.interpolate({inputRange: [0, 1], outputRange: [reducedMotion ? 0 : height || windowHeight, 0]})}]}}>
        {visible ? children : retained.current}
      </Animated.View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({root: {flex: 1, justifyContent: 'flex-end'}});
