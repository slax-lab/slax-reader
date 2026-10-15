import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {ActivityIndicator, AppState, Modal, StyleSheet, View, useWindowDimensions} from 'react-native'
import {GestureHandlerRootView} from 'react-native-gesture-handler'
import Animated, {cancelAnimation, useAnimatedStyle, useSharedValue, type SharedValue} from 'react-native-reanimated'
import {SourceText} from '../components'
import {ZoomableImage} from '../components/ZoomableImage'
import {useReducedMotion} from '../motion/useReducedMotion'
import {galleryPage} from './gallery-geometry'
export {imageFit} from './gallery-geometry'

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
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, images.length - 1)))
  const pageOffset = useSharedValue(0), pageGeneration = useSharedValue(0)
  const mounted = useRef(true)
  useLayoutEffect(() => {pageGeneration.value++; cancelAnimation(pageOffset); pageOffset.value = 0}, [index, viewport.width, viewport.height, pageOffset, pageGeneration])
  useEffect(() => {
    mounted.current = true
    return () => {mounted.current = false; pageGeneration.value++; cancelAnimation(pageOffset)}
  }, [pageOffset, pageGeneration])
  const commit = useCallback((displacement: number, velocity: number, generation?: number) => {
    if (!mounted.current || !isActive() || generation !== undefined && generation !== pageGeneration.value) return
    pageGeneration.value++; cancelAnimation(pageOffset)
    const next = galleryPage(index, displacement, velocity, viewport.width, images.length)
    if (next === index) pageOffset.value = 0
    else {setIndex(next); onIndex(next)}
  }, [isActive, images.length, viewport.width, index, onIndex, pageOffset, pageGeneration])
  const dismiss = useCallback(() => {if (mounted.current && isActive()) onDismiss()}, [onDismiss, isActive])
  const pages = [index - 1, index, index + 1].filter(value => value >= 0 && value < images.length)
  return <View testID="reader-image-gallery" style={styles.root} accessibilityViewIsModal accessibilityRole="adjustable"
    accessibilityValue={{min: 1, max: images.length, now: index + 1}} accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
    onAccessibilityAction={event => commit(event.nativeEvent.actionName === 'increment' ? -viewport.width : viewport.width, 0, pageGeneration.value)} onAccessibilityEscape={dismiss}>
    {pages.map(page => <GalleryImage key={`${page}:${images[page]}`} source={images[page]} identity={`${identity}:${page}:${images[page]}`} relative={page - index}
      width={viewport.width} height={viewport.height} active={page === index} canPrevious={index > 0} canNext={index < images.length - 1}
      pageOffset={pageOffset} pageGeneration={pageGeneration} onPage={commit} onDismiss={dismiss} resolveUri={resolveUri} isActive={isActive} errorLabel={errorLabel} />)}
    {images.length > 1 ? <SourceText pointerEvents="none" style={styles.count}>{index + 1} / {images.length}</SourceText> : null}
  </View>
}
function GalleryImage({source, identity, relative, width, height, active, canPrevious, canNext, pageOffset, pageGeneration, onPage, onDismiss, resolveUri, isActive, errorLabel}: {
  source: string; identity: string; relative: number; width: number; height: number; active: boolean; canPrevious: boolean; canNext: boolean
  pageOffset: SharedValue<number>; pageGeneration: SharedValue<number>; onPage(displacement: number, velocity: number, generation: number): void; onDismiss(): void
  resolveUri: Props['resolveUri']; isActive(): boolean; errorLabel: string
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
  const style = useAnimatedStyle(() => ({transform: [{translateX: relative * width + pageOffset.value}]}))
  return <Animated.View pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} style={[styles.page, {width, height}, style]}>
    <ZoomableImage uri={value?.failed ? null : value?.uri ?? null} identity={identity} width={width} height={height} active={active} pageOffset={pageOffset}
      pageGeneration={pageGeneration} canPrevious={canPrevious} canNext={canNext} onPage={onPage} onDismiss={onDismiss} onLoad={load} onError={fail}>
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
