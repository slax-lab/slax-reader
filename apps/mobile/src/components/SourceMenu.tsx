import React from 'react';
import { Animated, Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import type { MobileAssetName } from '../../assets';
import { mobileColors as C, mobileLayout as L, mobileTypography as T } from '../theme';
import { SourceIcon, SourceText } from './SourceUI';

export interface SourceMenuItem {label: string; icon?: MobileAssetName; selected?: boolean; color?: string; disabled?: boolean; onPress(): void}
export function SourceMenu({visible, onDismiss, items, anchor, width = L.menuWidth}: {visible: boolean; onDismiss(): void; items: SourceMenuItem[]; anchor: {x: number; y: number}; width?: number}) {
  const window = useWindowDimensions();
  const [mounted, setMounted] = React.useState(visible), presented = React.useRef(visible), motion = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!visible && !presented.current) return;
    if (visible) {presented.current = true; setMounted(true);}
    Animated.timing(motion, {toValue: visible ? 1 : 0, duration: visible ? 200 : 150, useNativeDriver: true}).start(({finished}) => {if (finished && !visible) {presented.current = false; setMounted(false);}});
    return () => motion.stopAnimation();
  }, [visible, motion]);
  if (!mounted && !visible) return null;
  const height = items.length * L.menuRowHeight + 36;
  return <Modal transparent visible={mounted || visible} animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
    <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onDismiss} />
    <Animated.View accessibilityViewIsModal style={[styles.menu, {width, opacity: motion, transform: [{scale: motion.interpolate({inputRange: [0, 1], outputRange: [0.92, 1]})}], left: Math.max(8, Math.min(anchor.x, window.width - width - 8)), top: Math.max(8, Math.min(anchor.y, window.height - height - 16))}]}>
      {items.map((item, index) => <Pressable key={index} accessibilityRole="menuitem" accessibilityState={{disabled: Boolean(item.disabled), selected: Boolean(item.selected)}} disabled={item.disabled} onPress={() => {onDismiss(); item.onPress();}} style={({pressed}) => [styles.item, {backgroundColor: pressed ? C.pressedOverlay : 'transparent', opacity: item.disabled ? 0.4 : 1}]}>
        {item.icon ? <SourceIcon name={item.icon} size={20} /> : null}
        <SourceText style={[T.menu, {flex: 1, color: item.color ?? C.text}]}>{item.label}</SourceText>
        {item.selected ? <SourceIcon name="ic_xs_tick_gray_outline_icon" size={12} /> : null}
      </Pressable>)}
    </Animated.View>
  </Modal>;
}
const styles = StyleSheet.create({menu: {position: 'absolute', backgroundColor: C.background, borderRadius: 20, borderColor: C.surface, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 18, shadowColor: '#000000', shadowOpacity: 0.08, shadowOffset: {width: 0, height: 5}, shadowRadius: 10, elevation: 8}, item: {minHeight: L.menuRowHeight, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12}});
