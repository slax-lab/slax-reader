import React, {useEffect, useRef, useState} from 'react'
import {Animated, Easing, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View} from 'react-native'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import {SourceSheetModal} from '../../components/SourceSheetModal'
import {mobileColors as C} from '../../theme'

export function ReaderSheet({visible, onDismiss, children, testID, inline = false, comment = false}: {visible: boolean; onDismiss(): void; children: React.ReactNode; testID?: string; inline?: boolean; comment?: boolean}) {
  const inset = useSafeAreaInsets()
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [mounted, setMounted] = useState(visible)
  const motion = useRef(new Animated.Value(0)).current
  const [sheetHeight, setSheetHeight] = useState(0)
  const retained = useRef(children)
  if (visible) retained.current = children
  useEffect(() => {
    if (!comment) return
    if (visible) setMounted(true)
    const animation = Animated.timing(motion, {toValue: visible ? 1 : 0, duration: 300, easing: Easing.bezier(.4, 0, .2, 1), useNativeDriver: true})
    animation.start(({finished}) => {if (finished && !visible) setMounted(false)})
    return () => animation.stop()
  }, [comment, visible, motion])
  useEffect(() => {
    if (!comment) return
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false))
    return () => {show.remove(); hide.remove()}
  }, [comment])
  const content = <KeyboardAvoidingView style={{flex: 1, justifyContent: 'flex-end'}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Animated.View style={[StyleSheet.absoluteFill, {backgroundColor: C.scrim, opacity: comment ? motion : 1}]}><Pressable accessible={false} onPress={onDismiss} style={StyleSheet.absoluteFill} /></Animated.View>
    <Animated.View testID={testID} accessibilityViewIsModal onLayout={comment ? event => setSheetHeight(event.nativeEvent.layout.height) : undefined} style={[styles.readerSheet, {marginTop: inset.top + 36, paddingBottom: inset.bottom}, comment && {maxHeight: '80%', flexShrink: 1, marginTop: 0, backgroundColor: C.background, paddingBottom: keyboardVisible ? 8 : inset.bottom, transform: [{translateY: motion.interpolate({inputRange: [0, 1], outputRange: [sheetHeight, 0]})}]}]}>{comment && !visible ? retained.current : children}</Animated.View>
  </KeyboardAvoidingView>
  if (inline) return (comment ? mounted || visible : visible) ? <View pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} style={[StyleSheet.absoluteFill, {zIndex: 5}]}>{content}</View> : null
  return <SourceSheetModal visible={visible} onDismiss={onDismiss}><View testID={testID} accessibilityViewIsModal style={[styles.readerSheet, {marginTop: inset.top + 36, paddingBottom: inset.bottom}]}>{children}</View></SourceSheetModal>
}
const styles = StyleSheet.create({readerSheet: {borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: C.readerBackground, overflow: 'hidden', maxHeight: '96%'}})
