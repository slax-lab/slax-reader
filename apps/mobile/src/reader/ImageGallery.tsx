import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Image, Modal, PanResponder, StyleSheet, View, useWindowDimensions } from 'react-native'
import { SourceText } from '../components'

interface Transform { scale: number; x: number; y: number }
interface GalleryPage {index: number; image: string}
interface GalleryRequest {page: GalleryPage; nativeKey: number; current(): boolean}
interface ResolvedImage {uri: string; request: GalleryRequest}
const initial = (): Transform => ({scale: 1, x: 0, y: 0})
const alwaysActive = () => true
export function imageFit(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  if (width <= 0 || height <= 0) return {width: viewportWidth, height: viewportHeight}
  const ratio = Math.min(viewportWidth / width, viewportHeight / height)
  return {width: width * ratio, height: height * ratio}
}
const clamp = (value: number, maximum: number) => Math.max(-maximum, Math.min(maximum, value))

/** Source gallery: fitted images, 1–5x pinch, 2.5x double tap and page handoff at pan edges. */
export function ImageGallery({images, index: initialIndex, resolveUri, onDismiss, errorLabel, allowNetworkFallback = true, isActive = alwaysActive}: {images: string[]; index: number; resolveUri(uri: string, signal?: AbortSignal): Promise<string | null>; onDismiss(): void; errorLabel: string; allowNetworkFallback?: boolean; isActive?(): boolean}) {
  const viewport = useWindowDimensions()
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, images.length - 1)))
  const page = useMemo(() => ({index, image: images[index]}), [index, images, resolveUri, allowNetworkFallback, isActive])
  const activePage = useRef<GalleryPage | null>(null), activeRequest = useRef<GalleryRequest | null>(null), requestSequence = useRef(0)
  const [resolved, setResolved] = useState<ResolvedImage | null>(null)
  const [loading, setLoading] = useState<{page: GalleryPage | null; busy: boolean; failed: boolean}>({page: null, busy: true, failed: false})
  const sizes = useRef(new Map<string, {width: number; height: number}>())
  const transforms = useRef(new Map<number, Transform>())
  const transform = useRef(initial())
  const scale = useRef(new Animated.Value(1)).current
  const x = useRef(new Animated.Value(0)).current
  const y = useRef(new Animated.Value(0)).current
  const lastTap = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reference = useRef({index, viewport, onDismiss})
  reference.current = {index, viewport, onDismiss}
  const sync = (next: Transform, animated = false) => {
    transform.current = next; transforms.current.set(reference.current.index, next)
    if (animated) Animated.parallel([Animated.timing(scale, {toValue: next.scale, duration: 300, useNativeDriver: true}), Animated.timing(x, {toValue: next.x, duration: 300, useNativeDriver: true}), Animated.timing(y, {toValue: next.y, duration: 300, useNativeDriver: true})]).start()
    else {scale.setValue(next.scale); x.setValue(next.x); y.setValue(next.y)}
  }
  useLayoutEffect(() => {
    activePage.current = page
    for (const storedIndex of transforms.current.keys()) if (storedIndex !== index) transforms.current.delete(storedIndex)
    sync(transforms.current.get(index) ?? initial())
    return () => {if (activePage.current === page) activePage.current = null}
  }, [page])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const current = () => active && !controller.signal.aborted && activePage.current === page && activeRequest.current === request && isActive()
    const request: GalleryRequest = {page, nativeKey: ++requestSequence.current, current}
    activeRequest.current = request
    setLoading({page, busy: true, failed: false}); setResolved(null)
    sync(transforms.current.get(index) ?? initial())
    const missing = () => {if (current()) {
      setLoading(previous => current() && previous.page === page ? {page, busy: false, failed: true} : previous)
    }}
    void resolveUri(page.image, controller.signal).then(local => {if (current() && local?.startsWith('file://')) setResolved({uri: local, request}); else missing()}).catch(missing)
    return () => {active = false; controller.abort(); if (activeRequest.current === request) activeRequest.current = null}
  }, [page])
  useEffect(() => () => {if (tapTimer.current) clearTimeout(tapTimer.current)}, [])
  const gesture = useRef({distance: 0, centroidX: 0, centroidY: 0, multi: false, start: initial(), page: false})
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      const touches = event.nativeEvent.touches
      gesture.current = {distance: touches.length > 1 ? Math.hypot(touches[1].pageX - touches[0].pageX, touches[1].pageY - touches[0].pageY) : 0,
        centroidX: touches.reduce((sum, touch) => sum + touch.pageX, 0) / touches.length,
        centroidY: touches.reduce((sum, touch) => sum + touch.pageY, 0) / touches.length,
        multi: touches.length > 1, start: {...transform.current}, page: false}
      scale.stopAnimation(); x.stopAnimation(); y.stopAnimation()
    },
    onPanResponderMove: (event, state) => {
      const touches = event.nativeEvent.touches
      const current = transform.current
      const size = sizes.current.get(images[reference.current.index]) ?? {width: reference.current.viewport.width, height: reference.current.viewport.height}
      const fit = imageFit(size.width, size.height, reference.current.viewport.width, reference.current.viewport.height)
      if (touches.length > 1) {
        gesture.current.multi = true
        const distance = Math.hypot(touches[1].pageX - touches[0].pageX, touches[1].pageY - touches[0].pageY)
        const centerX = (touches[0].pageX + touches[1].pageX) / 2
        const centerY = (touches[0].pageY + touches[1].pageY) / 2
        const nextScale = Math.max(1, Math.min(5, gesture.current.distance ? current.scale * distance / gesture.current.distance : current.scale))
        sync({scale: nextScale, x: clamp(current.x + centerX - gesture.current.centroidX, fit.width * (nextScale - 1) / 2), y: clamp(current.y + centerY - gesture.current.centroidY, fit.height * (nextScale - 1) / 2)})
        gesture.current.distance = distance; gesture.current.centroidX = centerX; gesture.current.centroidY = centerY
      } else if (!gesture.current.multi) {
        const maxX = fit.width * (current.scale - 1) / 2
        const maxY = fit.height * (current.scale - 1) / 2
        const outward = state.dx > 5 && gesture.current.start.x >= maxX - 20 || state.dx < -5 && gesture.current.start.x <= -maxX + 20
        gesture.current.page = current.scale === 1 || outward && Math.abs(state.dx) > Math.abs(state.dy)
        if (!gesture.current.page && current.scale > 1) sync({...current, x: clamp(gesture.current.start.x + state.dx, maxX), y: clamp(gesture.current.start.y + state.dy, maxY)})
      }
    },
    onPanResponderRelease: (_event, state) => {
      if (gesture.current.page && Math.abs(state.dx) > 60 && Math.abs(state.dx) > Math.abs(state.dy)) {
        setIndex(value => Math.max(0, Math.min(images.length - 1, value + (state.dx < 0 ? 1 : -1)))); return
      }
      if (!gesture.current.multi && Math.hypot(state.dx, state.dy) < 10) {
        const now = Date.now()
        if (now - lastTap.current < 280) {
          if (tapTimer.current) clearTimeout(tapTimer.current)
          lastTap.current = 0; sync(transform.current.scale > 1 ? initial() : {scale: 2.5, x: 0, y: 0}, true)
        } else {
          lastTap.current = now
          tapTimer.current = setTimeout(() => reference.current.onDismiss(), 280)
        }
      }
    },
    onPanResponderTerminationRequest: () => false,
  }), [images])
  const image = resolved?.request.page === page && resolved.request.current() ? resolved : null
  const busy = loading.page !== page || loading.busy, failed = loading.page === page && loading.failed
  return <Modal visible animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
    <View testID="reader-image-gallery" style={styles.root} {...responder.panHandlers}>
      {image ? <Animated.View style={[StyleSheet.absoluteFill, {transform: [{translateX: x}, {translateY: y}, {scale}]}]}>
        <Image key={`gallery-image-${image.request.nativeKey}`} source={{uri: image.uri}} resizeMode="contain" style={StyleSheet.absoluteFill} onLoad={event => {
          if (!image.request.current() || event.nativeEvent.source.uri && event.nativeEvent.source.uri !== image.uri) return
          sizes.current.set(image.request.page.image, event.nativeEvent.source)
          setLoading(previous => image.request.current() && previous.page === image.request.page ? {...previous, busy: false} : previous)
        }} onError={() => {
          if (!image.request.current()) return
          setLoading(previous => image.request.current() && previous.page === image.request.page ? {...previous, busy: false, failed: true} : previous)
        }} />
      </Animated.View> : null}
      {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
      {failed ? <SourceText style={{color: '#FFFFFF'}}>{errorLabel}</SourceText> : null}
      {images.length > 1 ? <SourceText pointerEvents="none" style={styles.count}>{index + 1} / {images.length}</SourceText> : null}
    </View>
  </Modal>
}
const styles = StyleSheet.create({root: {flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center'}, count: {position: 'absolute', bottom: 40, color: '#FFFFFF', fontSize: 14}})
