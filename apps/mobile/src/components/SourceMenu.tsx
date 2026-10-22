import React from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import {SafeAreaProvider, useSafeAreaFrame, useSafeAreaInsets} from 'react-native-safe-area-context';
import type { MobileAssetName } from '../../assets';
import { mobileColors as C, mobileLayout as L, mobileTypography as T } from '../theme';
import { SourceIcon, SourceText } from './SourceUI';
import {useReducedMotion} from '../motion/useReducedMotion';

export interface SourceMenuItem {label: string; icon?: MobileAssetName; selected?: boolean; color?: string; disabled?: boolean; onPress(): void}
export function SourceMenu({visible, onDismiss, items, anchor, width = L.menuWidth}: {visible: boolean; onDismiss(): void; items: SourceMenuItem[]; anchor: {x: number; y: number}; width?: number}) {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = React.useState(visible), presented = React.useRef(visible), motion = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!visible && !presented.current) return;
    let active = true;
    if (visible) {presented.current = true; setMounted(true);}
    const animation = Animated.timing(motion, {toValue: visible ? 1 : 0, duration: reducedMotion ? 0 : visible ? 200 : 150, useNativeDriver: true});
    animation.start(({finished}) => {if (active && finished && !visible) {presented.current = false; setMounted(false);}});
    return () => {active = false; animation.stop();};
  }, [visible, motion, reducedMotion]);
  if (!mounted && !visible) return null;
  return <Modal transparent presentationStyle="overFullScreen" visible={mounted || visible} animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
    <SafeAreaProvider><MenuSurface onDismiss={onDismiss} items={items} anchor={anchor} width={width} motion={motion}/></SafeAreaProvider>
  </Modal>;
}
function MenuSurface({onDismiss, items, anchor, width, motion}: {onDismiss(): void; items: SourceMenuItem[]; anchor: {x: number; y: number}; width: number; motion: Animated.Value}) {
  const frame = useSafeAreaFrame(), insets = useSafeAreaInsets();
  const [measuredHeight, setMeasuredHeight] = React.useState(0);
  const availableHeight = Math.max(0, frame.height - insets.top - insets.bottom - 24);
  const menuWidth = Math.min(width, Math.max(0, frame.width - insets.left - insets.right - 16));
  const height = Math.min(measuredHeight || items.length * L.menuRowHeight + 36, availableHeight);
  return <>
    <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onDismiss} />
    <Animated.View accessibilityViewIsModal onLayout={event => setMeasuredHeight(event.nativeEvent.layout.height)} style={[styles.menu, {width: menuWidth, maxHeight: availableHeight, opacity: motion, transform: [{scale: motion.interpolate({inputRange: [0, 1], outputRange: [0.92, 1]})}], left: Math.max(insets.left + 8, Math.min(anchor.x, frame.width - insets.right - menuWidth - 8)), top: Math.max(insets.top + 8, Math.min(anchor.y, frame.height - insets.bottom - height - 16))}]}>
      <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{flexGrow: 0}}>
      {items.map((item, index) => <Pressable key={index} accessibilityRole="menuitem" accessibilityState={{disabled: Boolean(item.disabled), selected: Boolean(item.selected)}} disabled={item.disabled} onPress={() => {onDismiss(); item.onPress();}} style={({pressed}) => [styles.item, {backgroundColor: pressed ? C.pressedOverlay : 'transparent', opacity: item.disabled ? 0.4 : 1}]}>
        {item.icon ? <SourceIcon name={item.icon} size={20} /> : null}
        <SourceText style={[T.menu, {flex: 1, color: item.color ?? C.text}]}>{item.label}</SourceText>
        {item.selected ? <SourceIcon name="ic_xs_tick_gray_outline_icon" size={12} /> : null}
      </Pressable>)}
      </ScrollView>
    </Animated.View>
  </>;
}
const styles = StyleSheet.create({menu: {position: 'absolute', backgroundColor: C.background, borderRadius: 20, borderColor: C.surface, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 18, shadowColor: '#000000', shadowOpacity: 0.08, shadowOffset: {width: 0, height: 5}, shadowRadius: 10, elevation: 8}, item: {minHeight: L.menuRowHeight, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12}});
