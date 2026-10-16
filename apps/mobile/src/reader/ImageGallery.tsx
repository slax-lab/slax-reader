import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {ActivityIndicator, AppState, Modal, StyleSheet, View, useWindowDimensions} from 'react-native'
import {GestureHandlerRootView} from 'react-native-gesture-handler'
import Animated, {cancelAnimation, useAnimatedStyle, useSharedValue, type SharedValue} from 'react-native-reanimated'
import type {ImageRef} from 'expo-image'
import {SourceText} from '../components'
import type {DecodedImageRetention} from '../components/AppImage'
import {ZoomableImage} from '../components/ZoomableImage'
import {useReducedMotion} from '../motion/useReducedMotion'
export {imageFit} from './gallery-geometry'

/** Decoded pages that left the current±1 window stay reusable until this budget or the gallery closes. */
const DECODED_RETENTION_BYTES = 40 * 1024 * 1024
function decodedRetention(budget: number): DecodedImageRetention & {close(): void} {
  const entries = new Map<string, {image: ImageRef; bytes: number}>()
  let total = 0, closed = false
  const drop = (key: string) => {const entry = entries.get(key); if (!entry) return; entries.delete(key); total -= entry.bytes; entry.image.release()}
  return {
    take(key) {const entry = entries.get(key); if (!entry) return null; entries.delete(key); total -= entry.bytes; return entry.image},
    keep(key, image) {
      const bytes = Math.max(1, (Number(image.width) || 0) * (Number(image.height) || 0) * (Number(image.scale) || 1) ** 2 * 4)
      if (closed || bytes > budget) {image.release(); return}
      drop(key); entries.set(key, {image, bytes}); total += bytes
      for (const oldest of [...entries.keys()]) {if (total <= budget) break; drop(oldest)}
    },
    close() {closed = true; for (const key of [...entries.keys()]) drop(key)},
  }
}

const alwaysActive = () => true
interface Props {
  images: string[]
  index: number
  resolveUri(uri: string, signal?: AbortSignal): Promise<string | null>
  onDismiss(): void
  errorLabel: string
  allowNetworkFallback?: boolean
  visible?: boolean
  isActive?(): boolean
}
export function ImageGallery({isActive = alwaysActive, visible = true, ...props}: Props) {
  const counter = useRef(0)
  const inputs = useRef<unknown[]>([])
  const next = [props.images, props.resolveUri, props.allowNetworkFallback, isActive]
  if (inputs.current.some((value, index) => value !== next[index])) {inputs.current = next; counter.current++}
  const identity = counter.current
  const reducedMotion = useReducedMotion()
  const [foreground, setForeground] = useState(AppState.currentState == null || AppState.currentState === 'active')
  const [position, setPosition] = useState({identity, index: props.index})
  const index = position.identity === identity ? position.index : props.index
  const owner = useRef(identity); owner.current = identity
  const changed = useCallback((value: number) => {if (owner.current === identity) setPosition({identity, index: value})}, [identity])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'))
    return () => subscription.remove()
  }, [])
  const active = foreground && visible && isActive()
  return <Modal visible={active} animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={props.onDismiss} statusBarTranslucent>
    <GestureHandlerRootView style={styles.root}>
      {active ? <GalleryPager key={identity} {...props} index={index} onIndex={changed} identity={identity} isActive={isActive} /> : null}
    </GestureHandlerRootView>
  </Modal>
}
function GalleryPager({images, index: initialIndex, resolveUri, onDismiss, errorLabel, identity, isActive, onIndex}: Props & {identity: number; isActive(): boolean; onIndex(index: number): void}) {
  const viewport = useWindowDimensions()
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, images.length - 1)))
  const current = useRef(index)
  // The UI runtime owns the absolute strip position; JS only learns which page settled.
  const pageOffset = useSharedValue(index * viewport.width)
  const mounted = useRef(true)
  const retention = useMemo(() => decodedRetention(DECODED_RETENTION_BYTES), [])
  useLayoutEffect(() => {cancelAnimation(pageOffset); pageOffset.value = current.current * viewport.width}, [viewport.width, pageOffset])
  useEffect(() => {
    mounted.current = true
    return () => {mounted.current = false; cancelAnimation(pageOffset); retention.close()}
  }, [pageOffset, retention])
  const commit = useCallback((page: number) => {
    const next = Math.max(0, Math.min(images.length - 1, page))
    if (!mounted.current || !isActive() || next === current.current) return
    current.current = next; setIndex(next); onIndex(next)
  }, [images.length, isActive, onIndex])
  const step = useCallback((delta: number) => {
    const next = Math.max(0, Math.min(images.length - 1, current.current + delta))
    if (!mounted.current || !isActive() || next === current.current) return
    cancelAnimation(pageOffset); pageOffset.value = next * viewport.width; commit(next)
  }, [images.length, isActive, pageOffset, viewport.width, commit])
  const dismiss = useCallback(() => {if (mounted.current && isActive()) onDismiss()}, [onDismiss, isActive])
  const pages = [index - 1, index, index + 1].filter(value => value >= 0 && value < images.length)
  return <View testID="reader-image-gallery" style={styles.root} accessibilityViewIsModal accessibilityRole="adjustable"
    accessibilityValue={{min: 1, max: images.length, now: index + 1}} accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
    onAccessibilityAction={event => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)} onAccessibilityEscape={dismiss}>
    {pages.map(page => <GalleryImage key={`${page}:${images[page]}`} source={images[page]} identity={`${identity}:${page}:${images[page]}`} page={page} pageCount={images.length}
      width={viewport.width} height={viewport.height} active={page === index} pageOffset={pageOffset} onPage={commit} onDismiss={dismiss}
      resolveUri={resolveUri} isActive={isActive} errorLabel={errorLabel} retention={retention} />)}
    {images.length > 1 ? <SourceText pointerEvents="none" style={styles.count}>{index + 1} / {images.length}</SourceText> : null}
  </View>
}
function GalleryImage({source, identity, page, pageCount, width, height, active, pageOffset, onPage, onDismiss, resolveUri, isActive, errorLabel, retention}: {
  source: string; identity: string; page: number; pageCount: number; width: number; height: number; active: boolean
  pageOffset: SharedValue<number>; onPage(page: number): void; onDismiss(): void
  resolveUri: Props['resolveUri']; isActive(): boolean; errorLabel: string; retention: DecodedImageRetention
}) {
  const request = useMemo(() => ({controller: new AbortController(), active: true, revision: 0}), [source, identity, resolveUri, isActive])
  const [result, setResult] = useState<{request: typeof request; uri: string | null; failed: boolean; loaded: boolean} | null>(null)
  const live = useRef(request); live.current = request
  const current = useCallback(() => live.current === request && request.active && !request.controller.signal.aborted && isActive(), [request, isActive])
  useEffect(() => {
    request.active = true; request.controller = new AbortController(); setResult(value => value?.request === request ? value : null)
    const revision = ++request.revision, controller = request.controller
    const valid = () => current() && revision === request.revision
    const failed = () => {if (valid()) setResult({request, uri: null, failed: true, loaded: false})}
    void resolveUri(source, controller.signal).then(uri => {
      if (!valid()) return
      if (!uri?.startsWith('file://')) {failed(); return}
      setResult({request, uri, failed: false, loaded: false})
    }).catch(failed)
    return () => {request.active = false; controller.abort()}
  }, [request, source, resolveUri, current])
  const load = useCallback(() => {if (current()) setResult(value => value?.request === request ? {...value, loaded: true} : value)}, [request, current])
  const fail = useCallback(() => {if (current()) setResult(value => value?.request === request ? {...value, failed: true, loaded: false} : value)}, [request, current])
  const value = result?.request === request && current() ? result : null
  const style = useAnimatedStyle(() => ({transform: [{translateX: page * width - pageOffset.value}]}))
  return <Animated.View accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} style={[styles.page, {width, height}, style]}>
    <ZoomableImage uri={value?.failed ? null : value?.uri ?? null} identity={identity} width={width} height={height} active={active} pageOffset={pageOffset}
      page={page} pageCount={pageCount} onPage={onPage} onDismiss={onDismiss} onLoad={load} onError={fail} retention={retention}>
      {!value?.failed && !value?.loaded ? <View pointerEvents="none" style={styles.center}><ActivityIndicator color="#FFFFFF" /></View> : null}
      {value?.failed ? <View pointerEvents="none" style={styles.center}><SourceText style={styles.error}>{errorLabel}</SourceText></View> : null}
    </ZoomableImage>
  </Animated.View>
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000000', overflow: 'hidden'}, page: {position: 'absolute', left: 0, top: 0},
  center: {...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center'}, error: {color: '#FFFFFF'},
  count: {position: 'absolute', bottom: 40, alignSelf: 'center', color: '#FFFFFF', fontSize: 14},
})
