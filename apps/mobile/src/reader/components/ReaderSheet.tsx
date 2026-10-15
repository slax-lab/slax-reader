import React, {useCallback, useEffect, useRef, useState} from 'react'
import {Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View} from 'react-native'
import Reanimated, {cancelAnimation, Easing as UiEasing, ReduceMotion, runOnJS, useSharedValue, withTiming, useAnimatedStyle} from 'react-native-reanimated'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import {SourceSheetModal} from '../../components/SourceSheetModal'
import {mobileColors as C} from '../../theme'

export function ReaderSheet({visible, onDismiss, children, testID, inline = false, comment = false}: {visible: boolean; onDismiss(): void; children: React.ReactNode; testID?: string; inline?: boolean; comment?: boolean}) {
  const inset = useSafeAreaInsets()
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [mounted, setMounted] = useState(visible)
  const motion = useSharedValue(0)
  const [sheetHeight, setSheetHeight] = useState(0)
  const retained = useRef(children), lifetime = useRef({visible, generation: 0, alive: true})
  lifetime.current.visible = visible
  if (visible) retained.current = children
  const complete = useCallback((generation: number) => {
    if (lifetime.current.alive && !lifetime.current.visible && lifetime.current.generation === generation) setMounted(false)
  }, [])
  useEffect(() => {
    lifetime.current.alive = true
    return () => {lifetime.current.alive = false; lifetime.current.generation++}
  }, [])
  useEffect(() => {
    if (!comment) return
    const generation = ++lifetime.current.generation
    if (visible) setMounted(true)
    motion.value = withTiming(visible ? 1 : 0, {duration: 300, easing: UiEasing.bezier(.4, 0, .2, 1), reduceMotion: ReduceMotion.System}, finished => {
      if (finished && !visible) runOnJS(complete)(generation)
    })
    return () => {lifetime.current.generation++; cancelAnimation(motion)}
  }, [comment, visible, motion, complete])
  useEffect(() => {
    if (!comment) return
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false))
    return () => {show.remove(); hide.remove()}
  }, [comment])
  const backdropStyle = useAnimatedStyle(() => ({opacity: comment ? motion.value : 1}))
  const sheetStyle = useAnimatedStyle(() => ({transform: [{translateY: (1 - motion.value) * sheetHeight}]}))
  const content = <KeyboardAvoidingView style={{flex: 1, justifyContent: 'flex-end'}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Reanimated.View style={[StyleSheet.absoluteFill, {backgroundColor: C.scrim}, backdropStyle]}><Pressable accessible={false} onPress={onDismiss} style={StyleSheet.absoluteFill} /></Reanimated.View>
    <Reanimated.View testID={testID} accessibilityViewIsModal onLayout={comment ? event => setSheetHeight(event.nativeEvent.layout.height) : undefined} style={[styles.readerSheet, {marginTop: inset.top + 36, paddingBottom: inset.bottom}, comment && {maxHeight: '80%', flexShrink: 1, marginTop: 0, backgroundColor: C.background, paddingBottom: keyboardVisible ? 8 : inset.bottom}, comment && sheetStyle]}>{comment && !visible ? retained.current : children}</Reanimated.View>
  </KeyboardAvoidingView>
  if (inline) return (comment ? mounted || visible : visible) ? <View pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} style={[StyleSheet.absoluteFill, {zIndex: 5}]}>{content}</View> : null
  return <SourceSheetModal visible={visible} onDismiss={onDismiss}><View testID={testID} accessibilityViewIsModal style={[styles.readerSheet, {marginTop: inset.top + 36, paddingBottom: inset.bottom}]}>{children}</View></SourceSheetModal>
}
const styles = StyleSheet.create({readerSheet: {borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: C.readerBackground, overflow: 'hidden', maxHeight: '96%'}})
