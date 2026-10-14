import React, {useEffect, useRef, useState} from 'react'
import {ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions} from 'react-native'
import Reanimated, {cancelAnimation, Easing as UiEasing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming} from 'react-native-reanimated'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import {SourceIcon, SourceText, TextAction} from '../../components'
import {mobileColors as C, mobileTypography as T} from '../../theme'
import {outlineMotion, type OutlineStatus} from '../outline-motion'
import {MarkdownView} from '../MarkdownView'
import type {Translate} from '../state/types'
import {IconAction} from './IconAction'

export function OutlineSheet({status, toolbarVisible, markdown, pending, busy, error, position, t, onClose, onCollapse, onExpand, onRetry, onLink, onPosition}: {status: OutlineStatus; toolbarVisible: boolean; markdown: string; pending: boolean; busy: boolean; error: string | null; position: number; t: Translate; onClose(): void; onCollapse(): void; onExpand(): void; onRetry(): void; onLink(href: string): void; onPosition(position: number): void}) {
  const viewport = useWindowDimensions(), inset = useSafeAreaInsets()
  const previous = useRef<OutlineStatus>('hidden')
  const [contentReady, setContentReady] = useState(false)
  const background = useSharedValue(0), expanded = useSharedValue(0), slide = useSharedValue(1), collapsed = useSharedValue(0), morph = useSharedValue(0), morphAlpha = useSharedValue(0)
  const values = React.useMemo(() => ({background, expanded, slide, collapsed, morph, morphAlpha}), [background, expanded, slide, collapsed, morph, morphAlpha])
  const toolbarOffset = useSharedValue(toolbarVisible ? 0 : 150)
  useEffect(() => {
    toolbarOffset.value = withTiming(toolbarVisible ? 0 : 150, {duration: 300, easing: UiEasing.bezier(.4, 0, .2, 1)})
    return () => cancelAnimation(toolbarOffset)
  }, [toolbarVisible, toolbarOffset])
  useEffect(() => {
    const motion = outlineMotion(previous.current, status)
    previous.current = status
    if (status === 'expanded') setContentReady(true)
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      const steps = motion[key].map(step => withDelay(step.delay ?? 0, withTiming(step.toValue, {duration: step.duration, easing: step.linear ? UiEasing.linear : UiEasing.bezier(.4, 0, .2, 1)})))
      values[key].value = withSequence(steps[0]!, ...steps.slice(1))
    }
    return () => {for (const value of Object.values(values)) cancelAnimation(value)}
  }, [status, values])
  const height = viewport.height - inset.top - 36, bottom = inset.bottom + 24
  const backgroundStyle = useAnimatedStyle(() => ({opacity: background.value}))
  const morphStyle = useAnimatedStyle(() => ({opacity: morphAlpha.value, width: 50 + (viewport.width - 50) * morph.value, height: 50 + (height - 50) * morph.value,
    bottom: bottom * (1 - morph.value), borderTopLeftRadius: 25 - 5 * morph.value, borderTopRightRadius: 25 - 5 * morph.value,
    borderBottomLeftRadius: 25 * (1 - morph.value), borderBottomRightRadius: 25 * (1 - morph.value), transform: [{translateX: -87 * (1 - morph.value)}]}))
  const panelStyle = useAnimatedStyle(() => ({opacity: expanded.value, transform: [{translateY: viewport.height * slide.value}]}))
  const collapsedStyle = useAnimatedStyle(() => ({opacity: collapsed.value, transform: [{translateX: -87}, {translateY: toolbarOffset.value}]}))
  if (status === 'none') return null
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, {zIndex: 4}]}>
    <Reanimated.View pointerEvents={status === 'expanded' ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, {backgroundColor: '#000000'}, backgroundStyle]}><Pressable testID="reader-outline-dismiss" accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} /></Reanimated.View>
    <Reanimated.View testID="reader-outline-morph" pointerEvents="none" style={[{position: 'absolute', alignSelf: 'center', backgroundColor: C.surface}, morphStyle]} />
    <Reanimated.View testID="reader-outline-panel" pointerEvents={status === 'expanded' ? 'auto' : 'none'} accessibilityViewIsModal={status === 'expanded'} accessibilityElementsHidden={status !== 'expanded'} importantForAccessibility={status === 'expanded' ? 'auto' : 'no-hide-descendants'} style={[styles.outlinePanel, {height, paddingBottom: inset.bottom}, panelStyle]}>
      <View style={{flex: 1, paddingTop: 32}}>
        {error ? <View style={styles.center}><SourceText style={{fontSize: 16, fontWeight: '500', color: '#FF5252'}}>{t('outline_error')}</SourceText><SourceText style={{fontSize: 12, color: C.mutedText, marginTop: 8}}>{error}</SourceText><TextAction label={t('rss_retry')} onPress={onRetry} /></View> : pending && busy ? <View style={styles.center}><ActivityIndicator color={C.bodyText} /><SourceText style={[T.helper, {marginTop: 12}]}>{t('outline_summarizing')}</SourceText></View> : contentReady ?
          <MarkdownView markdown={markdown || t('outline_empty')} initialPosition={position} onLink={onLink} onPosition={onPosition} /> : null}
        {busy && !pending ? <View style={{paddingVertical: 20}}><ActivityIndicator color={C.bodyText} /></View> : null}
      </View>
      <View testID="reader-outline-footer" style={{height: 55, flexDirection: 'row', alignItems: 'center'}}>
        <Pressable testID="reader-outline-minimize" accessibilityRole="button" onPress={onCollapse} style={({pressed}) => [styles.outlineFooterAction, {opacity: pressed ? .5 : 1}]}><SourceIcon name="ic_outline_dialog_shrink" size={24} style={{tintColor: '#666666'}} /><SourceText style={[T.helper, {color: C.secondaryText}]}>{t('outline_minimize')}</SourceText></Pressable>
        <View style={{width: 1, height: 16, backgroundColor: '#33333314'}} />
        <Pressable testID="reader-outline-close" accessibilityRole="button" onPress={onClose} style={({pressed}) => [styles.outlineFooterAction, {opacity: pressed ? .5 : 1}]}><SourceIcon name="ic_outline_dialog_close" size={24} style={{tintColor: '#666666'}} /><SourceText style={[T.helper, {color: C.secondaryText}]}>{t('btn_close')}</SourceText></Pressable>
      </View>
    </Reanimated.View>
    <Reanimated.View pointerEvents={status === 'collapsed' && toolbarVisible ? 'auto' : 'none'} accessibilityElementsHidden={status !== 'collapsed' || !toolbarVisible} importantForAccessibility={status === 'collapsed' && toolbarVisible ? 'auto' : 'no-hide-descendants'} style={[styles.floatingCircle, {position: 'absolute', alignSelf: 'center', bottom}, collapsedStyle]}><IconAction name="ic_outline_collapsed" label={t('outline_expand')} size={20} onPress={onExpand} testID="reader-outline-expand" /></Reanimated.View>
  </View>
}
const styles = StyleSheet.create({
  floatingCircle: {width: 50, height: 50, borderRadius: 25, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 40, shadowOffset: {width: 0, height: 10}, elevation: 8},
  outlinePanel: {position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: C.surface, overflow: 'hidden'},
  outlineFooterAction: {flex: 1, height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20},
})
