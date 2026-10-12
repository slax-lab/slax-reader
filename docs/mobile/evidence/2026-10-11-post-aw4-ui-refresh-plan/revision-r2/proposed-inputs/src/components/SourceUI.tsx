import React from 'react';
import { ActivityIndicator, Animated, Image, KeyboardAvoidingView, Modal, PanResponder, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ImageSourcePropType, type ImageStyle, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mobileAssets, type MobileAssetName } from '../../assets';
import { mobileColors as C, mobileTypography as T } from '../theme';
import { sourceTextDimensions } from './source-font-scaling';

export function SourceText({style, ...props}: TextProps) {
  const {fontScale} = useWindowDimensions();
  const dimensions = Platform.OS === 'android'
    ? sourceTextDimensions(StyleSheet.flatten([styles.text, style]), fontScale, props.allowFontScaling !== false, props.maxFontSizeMultiplier)
    : undefined;
  return <Text textBreakStrategy={Platform.OS === 'android' ? 'simple' : undefined}
    android_hyphenationFrequency={Platform.OS === 'android' ? 'none' : undefined}
    {...props} allowFontScaling={Platform.OS === 'android' ? false : props.allowFontScaling}
    style={[styles.text, style, dimensions]} />;
}
export function SourceIcon({name, size = 24, label, style, testID}: {name: MobileAssetName; size?: number; label?: string; testID?: string; style?: StyleProp<ImageStyle>}) {
  const roundedSize = Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(size) : size;
  return <Image testID={testID} source={mobileAssets[name]} resizeMode="contain" accessibilityLabel={label} accessible={Boolean(label)} style={[{width: roundedSize, height: roundedSize}, style]} />;
}
export function SourceAvatar({uri, size = 40, label}: {uri?: string; size?: number; label?: string}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [uri]);
  const source: ImageSourcePropType = uri && !failed ? {uri} : mobileAssets.global_default_avatar;
  const roundedSize = Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(size) : size;
  return <Image source={source} onError={() => setFailed(true)} accessibilityLabel={label} resizeMode="cover" style={{width: roundedSize, height: roundedSize, borderRadius: roundedSize / 2}} />;
}
export function SourceButton({label, onPress, disabled, busy, destructive, testID, style, textStyle, tone = 'accent'}: {
  label: string; onPress(): void; disabled?: boolean; busy?: boolean; destructive?: boolean; testID?: string;
  style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle>; tone?: 'accent' | 'surface' | 'rss';
}) {
  const color = tone === 'surface' ? C.surface : tone === 'rss' ? C.rssAccent : C.accent;
  return <Pressable accessibilityRole="button" accessibilityState={{disabled: Boolean(disabled), busy: Boolean(busy)}} testID={testID} disabled={disabled || busy} onPress={onPress}
    style={({pressed}) => [styles.button, {backgroundColor: disabled ? C.disabledBackground : pressed ? tone === 'accent' ? C.accentPressed : C.pressedOverlay : color}, style]}>
    {busy ? <ActivityIndicator size="small" color={destructive ? C.danger : tone === 'surface' ? C.text : C.surface} /> :
      <SourceText style={[T.button, {color: disabled ? C.mutedText : destructive ? C.danger : tone === 'surface' ? C.text : C.surface}, textStyle]}>{label}</SourceText>}
  </Pressable>;
}
export function TextAction({label, onPress, disabled, color = C.accent, testID, style}: {label: string; onPress(): void; disabled?: boolean; color?: string; testID?: string; style?: StyleProp<TextStyle>}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled: Boolean(disabled)}} testID={testID} disabled={disabled} onPress={onPress} hitSlop={4} style={({pressed}) => [styles.textAction, {opacity: pressed ? 0.5 : 1}]}>
    <SourceText style={[T.metadata, {color: disabled ? C.mutedText : color}, style]}>{label}</SourceText>
  </Pressable>;
}
export function Divider({inset = 0}: {inset?: number}) {
  return <View style={{height: PixelRatio.roundToNearestPixel(0.5), backgroundColor: '#33333314', marginHorizontal: inset}} />;
}
export function SourceProgress({value, height = 5, color = C.accent, testID}: {value?: number; height?: number; color?: string; testID?: string}) {
  const [width, setWidth] = React.useState(0), offset = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (value !== undefined) return;
    const loop = Animated.loop(Animated.timing(offset, {toValue: 1, duration: 1500, useNativeDriver: true})); loop.start();
    return () => {loop.stop(); offset.setValue(0);};
  }, [offset, value]);
  return <View testID={testID} accessibilityRole="progressbar" accessibilityValue={value === undefined ? undefined : {min: 0, max: 100, now: Math.round(value * 100)}} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{height, backgroundColor: C.syncTrack, overflow: 'hidden', borderRadius: height / 2}}>
    {value === undefined ? <Animated.View style={{height, width: width / 3, backgroundColor: color, transform: [{translateX: offset.interpolate({inputRange: [0, 1], outputRange: [-width / 3, width]})}]}} /> : <View style={{height, width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color}} />}
  </View>;
}
export function SourceSwitch({value, onChange, disabled, label}: {value: boolean; onChange(value: boolean): void; disabled?: boolean; label: string}) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{checked: value, disabled: Boolean(disabled)}} disabled={disabled} onPress={() => onChange(!value)} hitSlop={8} style={{width: 52, height: 32, borderRadius: 16, backgroundColor: value ? C.accent : C.switchOff, opacity: disabled ? 0.38 : 1}}><View style={{position: 'absolute', width: value ? 24 : 16, height: value ? 24 : 16, borderRadius: 12, backgroundColor: C.surface, left: value ? 24 : 8, top: value ? 4 : 8}} /></Pressable>;
}
export function ScreenSurface({children, style, testID, bottomInset = true, sourceAppBar = false}: {children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string; bottomInset?: boolean; sourceAppBar?: boolean}) {
  const insets = useSafeAreaInsets();
  // These source M3 pages place their body below a 64dp app bar. The native
  // Android stack retains its 56dp toolbar/back button and supplies the inset.
  return <View testID={testID} style={[styles.screen, sourceAppBar && Platform.OS === 'android' && {paddingTop: 8}, bottomInset && {paddingBottom: insets.bottom}, style]}>{children}</View>;
}
/** Source Compose overlay; route back remains owned by the native navigator. */
export function SourceDialog({visible, onDismiss, title, children, actions, testID, compact = false, dismissible = true}: {
  visible: boolean; onDismiss(): void; title?: string; children?: React.ReactNode; actions?: React.ReactNode; testID?: string; compact?: boolean; dismissible?: boolean;
}) {
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (dismissible) onDismiss(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modal}>
      <Pressable accessibilityLabel="" accessible={false} onPress={() => { if (dismissible) onDismiss(); }} style={[StyleSheet.absoluteFill, styles.scrim]} />
      <View accessibilityViewIsModal testID={testID} style={[styles.dialog, compact && styles.compactDialog]}>
        {title ? <SourceText accessibilityRole="header" style={[T.dialogTitle, styles.dialogTitle]}>{title}</SourceText> : null}
        {children}
        {actions ? <View style={styles.dialogActions}>{actions}</View> : null}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
export function SourceSheet({visible, onDismiss, busy, children, style, contentContainerStyle, bottomPadding = 24, handleColor}: {visible: boolean; onDismiss(): void; busy?: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>; contentContainerStyle?: StyleProp<ViewStyle>; bottomPadding?: number; handleColor?: string}) {
  const inset = useSafeAreaInsets();
  const drag = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {if (visible) drag.setValue(0);}, [visible, drag]);
  const pan = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => !busy && Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_event, gesture) => drag.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (!busy && (gesture.dy > 80 || gesture.vy > 1)) onDismiss();
      else Animated.timing(drag, {toValue: 0, duration: 200, useNativeDriver: true}).start();
    },
    onPanResponderTerminate: () => Animated.timing(drag, {toValue: 0, duration: 200, useNativeDriver: true}).start(),
  }), [busy, drag, onDismiss]);
  return <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => { if (!busy) onDismiss(); }}>
    <KeyboardAvoidingView style={styles.sheetModal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable accessible={false} onPress={() => { if (!busy) onDismiss(); }} style={[StyleSheet.absoluteFill, styles.scrim]} />
      <Animated.View accessibilityViewIsModal style={[styles.sheet, style, {paddingBottom: inset.bottom + bottomPadding, transform: [{translateY: drag}]}]}>
        <View {...pan.panHandlers} style={{alignSelf: 'stretch'}}><View style={[styles.sheetHandle, handleColor ? {backgroundColor: handleColor} : undefined]} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[{gap: 16}, contentContainerStyle]}>{children}</ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({
  text: {...T.body, color: C.text, includeFontPadding: false}, screen: {flex: 1, backgroundColor: C.background},
  button: {minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10},
  textAction: {minHeight: 40, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center'},
  modal: {flex: 1, justifyContent: 'center', padding: 24}, scrim: {backgroundColor: C.scrim},
  dialog: {backgroundColor: C.surface, borderRadius: 28, padding: 24, maxHeight: '90%'},
  compactDialog: {borderRadius: 12, paddingHorizontal: 20, paddingVertical: 24, marginHorizontal: -12},
  dialogTitle: {marginBottom: 16}, dialogActions: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 20},
  sheetModal: {flex: 1, justifyContent: 'flex-end'}, sheet: {maxHeight: '92%', paddingHorizontal: 24, backgroundColor: C.readerBackground, borderTopLeftRadius: 24, borderTopRightRadius: 24},
  sheetHandle: {alignSelf: 'center', backgroundColor: '#79747E', height: 4, width: 32, borderRadius: 2, marginVertical: 22},
});
