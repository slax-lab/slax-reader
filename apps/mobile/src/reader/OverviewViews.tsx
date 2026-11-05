import React, {useEffect, useRef, useState} from 'react'
import {Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type GestureResponderEvent, type LayoutChangeEvent} from 'react-native'
import Reanimated, {cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated'
import {SourceIcon, SourceText} from '../components'
import {useReducedMotion} from '../motion/useReducedMotion'

/** Window-space frame of the overview excerpt, the origin of the source dialog's expansion. */
export interface OverviewBounds {x: number; y: number; width: number; height: number}

/** Source OverviewView: omit empty results and append the source arrow to the excerpt. Presses report the excerpt's frame. */
export function OverviewExcerpt({content, prefix, onPress}: {content: string; prefix: string; onPress(bounds: OverviewBounds | null): void}) {
  const size = useRef({width: 0, height: 0})
  if (!content) return null
  const press = (event: GestureResponderEvent) => {
    const {pageX, pageY, locationX, locationY} = event.nativeEvent ?? {}
    const x = pageX - locationX, y = pageY - locationY
    onPress(size.current.width > 0 && Number.isFinite(x) && Number.isFinite(y) ? {x, y, ...size.current} : null)
  }
  return <Pressable testID="reader-overview-excerpt" accessibilityRole="button" onPress={press} style={styles.excerpt}
    onLayout={(event: LayoutChangeEvent) => {const {width, height} = event.nativeEvent.layout; size.current = {width, height}}}>
    {/* Touches resolve to the excerpt itself, so the press location is relative to its frame. */}
    <View pointerEvents="none">
      <SourceText numberOfLines={3} style={styles.excerptText}><SourceText style={[styles.excerptText, {color: '#999999'}]}>{prefix}</SourceText>{content}{' '}<SourceIcon name="ic_xs_blue_down_arrow" size={8} /></SourceText>
    </View>
  </Pressable>
}

const fastOutSlowIn = Easing.bezier(.4, 0, .2, 1)
/**
 * Source OverviewDialog: an opaque surface fades in over 300 ms while the card grows from the excerpt's frame to a centered
 * card (250 ms FastOutSlowIn), with the close icon 34 points beneath it. Dismissal reverses both before unmounting.
 */
export function OverviewDialog({visible, content, takeaways, title, closeLabel, sourceBounds, onClose}: {visible: boolean; content: string; takeaways: string[]; title: string; closeLabel: string; sourceBounds?: OverviewBounds | null; onClose(): void}) {
  const window = useWindowDimensions(), reducedMotion = useReducedMotion()
  const [mounted, setMounted] = useState(visible)
  const [contentHeight, setContentHeight] = useState(0)
  const progress = useSharedValue(visible && reducedMotion ? 1 : 0), appear = useSharedValue(visible && reducedMotion ? 1 : 0)
  const opened = useRef(false)
  useEffect(() => {
    if (!visible && !opened.current) return
    opened.current = true
    cancelAnimation(progress); cancelAnimation(appear)
    if (visible) setMounted(true)
    const target = visible ? 1 : 0
    if (reducedMotion) {progress.value = target; appear.value = target; if (!visible) setMounted(false); return}
    const done = (finished?: boolean) => {'worklet'; if (finished && !visible) runOnJS(setMounted)(false)}
    progress.value = withTiming(target, {duration: 250, easing: fastOutSlowIn, reduceMotion: ReduceMotion.System})
    appear.value = withTiming(target, {duration: 300, easing: fastOutSlowIn, reduceMotion: ReduceMotion.System}, done)
  }, [visible, reducedMotion, progress, appear])
  useEffect(() => () => {cancelAnimation(progress); cancelAnimation(appear)}, [progress, appear])
  const width = window.width, height = window.height
  const cardWidth = Math.max(0, width - 40), cardHeight = Math.min(contentHeight || height * .8, height * .8)
  const cardX = (width - cardWidth) / 2, cardY = (height - cardHeight) / 2
  const source = sourceBounds ?? {x: width / 2, y: height / 2, width: 0, height: 0}
  const cardStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    left: source.x + (cardX - source.x) * progress.value, top: source.y + (cardY - source.y) * progress.value,
    width: source.width + (cardWidth - source.width) * progress.value, height: source.height + (cardHeight - source.height) * progress.value,
  }))
  const closeStyle = useAnimatedStyle(() => ({top: source.y + (cardY - source.y) * progress.value + source.height + (cardHeight - source.height) * progress.value + 34}))
  const rootStyle = useAnimatedStyle(() => ({opacity: appear.value}))
  if (!mounted) return null
  return <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <Reanimated.View testID="reader-overview-surface" pointerEvents={visible ? 'auto' : 'none'} accessibilityViewIsModal style={[styles.modal, rootStyle]}>
      <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />
      <Reanimated.View style={[styles.card, cardStyle]} testID="reader-overview-dialog">
        {/* The contents keep their final width, so the growing card reveals them without re-laying out text each frame. */}
        <View style={{width: cardWidth, height: cardHeight}}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.contents} onLayout={event => setContentHeight(event.nativeEvent.layout.height)}>
              <SourceText style={styles.title}>{title}</SourceText>
              {content ? <SourceText selectable style={styles.summary}>{content}</SourceText> : null}
              {takeaways.length ? <View style={{marginTop: 14}}>{takeaways.map((text, index) => <View key={index} style={styles.takeaway}>
                <View style={styles.timeline}>
                  {index > 0 ? <View style={[styles.timelineLine, {top: 0, bottom: '50%', marginBottom: 7}]} /> : null}
                  {index < takeaways.length - 1 ? <View style={[styles.timelineLine, {top: '50%', bottom: 0, marginTop: 7}]} /> : null}
                  <View style={styles.dot} />
                </View>
                <SourceText style={styles.takeawayText}>{text}</SourceText>
              </View>)}</View> : null}
            </View>
          </ScrollView>
        </View>
      </Reanimated.View>
      <Reanimated.View style={[styles.close, closeStyle]}>
        <Pressable testID="reader-overview-close" accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} hitSlop={8}><SourceIcon name="ic_circle_close_icon" size={24} /></Pressable>
      </Reanimated.View>
    </Reanimated.View>
  </Modal>
}

const styles = StyleSheet.create({
  excerpt: {marginTop: 20, backgroundColor: '#F5F5F3', borderRadius: 8, padding: 12},
  excerptText: {fontSize: 14, lineHeight: 20, color: '#333333', fontWeight: '400', includeFontPadding: false},
  modal: {flex: 1, backgroundColor: '#F5F5F3'},
  card: {position: 'absolute', backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden'},
  contents: {paddingVertical: 24, paddingHorizontal: 20},
  title: {fontSize: 14, lineHeight: 20, color: '#999999', includeFontPadding: false},
  summary: {marginTop: 20, fontSize: 16, lineHeight: 27, color: '#333333', includeFontPadding: false},
  takeaway: {flexDirection: 'row', alignItems: 'stretch'},
  timeline: {width: 6, justifyContent: 'center', alignItems: 'center'},
  timelineLine: {position: 'absolute', width: 1, backgroundColor: '#33333314'},
  dot: {width: 6, height: 6, backgroundColor: '#F5F5F3CC', borderWidth: 1.26, borderColor: '#D3D3D3', borderRadius: 3},
  takeawayText: {flex: 1, paddingLeft: 12, paddingVertical: 6, fontSize: 14, lineHeight: 20, color: '#333333CC', includeFontPadding: false},
  close: {position: 'absolute', alignSelf: 'center', width: 24, height: 24},
})
