import React, {useEffect, useState} from 'react'
import {StyleSheet} from 'react-native'
import Animated, {cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated'
import {motionDuration} from '../motion/policy'

/**
 * Covers a Reader document host with the article skeleton until the document is presentable, then fades out once and unmounts.
 * The cover is hidden from assistive technology; the host's own header stays reachable beneath it.
 */
export function ReaderLoadingCover({covered, testID, children}: {covered: boolean; testID: string; children: React.ReactNode}) {
  const [mounted, setMounted] = useState(covered)
  const opacity = useSharedValue(covered ? 1 : 0)
  useEffect(() => {
    cancelAnimation(opacity)
    if (covered) {opacity.value = 1; setMounted(true); return}
    opacity.value = withTiming(0, {duration: motionDuration.contentReveal, easing: Easing.out(Easing.ease), reduceMotion: ReduceMotion.System}, finished => {
      if (finished) runOnJS(setMounted)(false)
    })
  }, [covered, opacity])
  const style = useAnimatedStyle(() => ({opacity: opacity.value}))
  if (!mounted) return null
  return <Animated.View testID={testID} pointerEvents={covered ? 'auto' : 'none'} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.cover, style]}>{children}</Animated.View>
}
const styles = StyleSheet.create({cover: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#FCFCFC', overflow: 'hidden'}})
