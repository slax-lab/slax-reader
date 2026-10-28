import React, {useEffect} from 'react'
import {PixelRatio, StyleSheet, View} from 'react-native'
import Reanimated, {cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming} from 'react-native-reanimated'
import {useReducedMotion} from '../../motion/useReducedMotion'

const fastOutSlowIn = Easing.bezier(.4, 0, .2, 1)
const lineColors = ['#16B998', '#FFC255', '#56CAF2', '#FB8F6C'] as const
const ringDots = 20

/** Source SkeletonLoadingAnimation: three 18-point bars pulsing 0.3 ↔ 1 over 800 ms. Reduced motion holds them opaque. */
export function OutlineSkeleton({label}: {label: string}) {
  const reducedMotion = useReducedMotion()
  const alpha = useSharedValue(reducedMotion ? 1 : .3)
  useEffect(() => {
    cancelAnimation(alpha)
    if (reducedMotion) {alpha.value = 1; return}
    alpha.value = .3
    alpha.value = withRepeat(withTiming(1, {duration: 800, easing: fastOutSlowIn, reduceMotion: ReduceMotion.System}), -1, true, undefined, ReduceMotion.System)
    return () => cancelAnimation(alpha)
  }, [alpha, reducedMotion])
  const style = useAnimatedStyle(() => ({opacity: alpha.value}))
  return <View testID="reader-outline-skeleton" accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.skeleton}>
    {[0, 1, 2].map(index => <Reanimated.View key={index} style={[styles.skeletonBar, style]} />)}
  </View>
}

/** Source DotsLineLoadingAnimation: four 4-point dots bouncing ±2.4 px over 1400 ms, staggered by 250 ms. */
export function OutlineDotsLine() {
  return <View testID="reader-outline-dots-line" style={styles.dotsLine} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {lineColors.map((color, index) => <BouncingDot key={color} color={color} delay={index * 250} />)}
  </View>
}
function BouncingDot({color, delay}: {color: string; delay: number}) {
  const reducedMotion = useReducedMotion()
  const offset = useSharedValue(0)
  useEffect(() => {
    cancelAnimation(offset)
    offset.value = 0
    if (reducedMotion) return
    const amplitude = 2.4 / PixelRatio.get(), step = (toValue: number, duration: number) => withTiming(toValue, {duration, easing: Easing.linear, reduceMotion: ReduceMotion.System})
    offset.value = withDelay(delay, withRepeat(withSequence(step(-amplitude, 350), step(amplitude, 700), step(0, 350)), -1, false, undefined, ReduceMotion.System), ReduceMotion.System)
    return () => cancelAnimation(offset)
  }, [offset, delay, reducedMotion])
  const style = useAnimatedStyle(() => ({transform: [{translateY: offset.value}]}))
  return <Reanimated.View style={[styles.dot, {backgroundColor: color}, style]} />
}

/** Source DotsRingLoadingAnimation: 20 dots on a 27-point ring fading green → pale, rotating once per 1500 ms. */
export function OutlineDotsRing({size = 27}: {size?: number}) {
  const reducedMotion = useReducedMotion()
  const rotation = useSharedValue(0)
  useEffect(() => {
    cancelAnimation(rotation)
    rotation.value = 0
    if (reducedMotion) return
    rotation.value = withRepeat(withTiming(360, {duration: 1500, easing: Easing.linear, reduceMotion: ReduceMotion.System}), -1, false, undefined, ReduceMotion.System)
    return () => cancelAnimation(rotation)
  }, [rotation, reducedMotion])
  const style = useAnimatedStyle(() => ({transform: [{rotate: `${rotation.value}deg`}]}))
  const radius = size / 2, dot = 1.5
  return <Reanimated.View testID="reader-outline-dots-ring" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[{position: 'absolute', width: size, height: size}, style]}>
    {Array.from({length: ringDots}, (_, index) => {
      const angle = 2 * Math.PI * index / ringDots - Math.PI / 2
      return <View key={index} style={[styles.ringDot, {width: dot, height: dot, borderRadius: dot / 2, backgroundColor: ringColor(index / ringDots),
        left: radius + radius * Math.cos(angle) - dot / 2, top: radius + radius * Math.sin(angle) - dot / 2}]} />
    })}
  </Reanimated.View>
}
const start = [0x16, 0xB9, 0x98], end = [0xEC, 0xF9, 0xF6]
function ringColor(fraction: number) {
  return `#${start.map((value, index) => Math.round(value + (end[index] - value) * fraction).toString(16).padStart(2, '0')).join('')}`
}

const styles = StyleSheet.create({
  skeleton: {gap: 12},
  skeletonBar: {height: 18, borderRadius: 4, experimental_backgroundImage: 'linear-gradient(to right, #F5F5F3, #F5F5F399)'},
  dotsLine: {height: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4},
  dot: {width: 4, height: 4, borderRadius: 2},
  ringDot: {position: 'absolute'},
})
