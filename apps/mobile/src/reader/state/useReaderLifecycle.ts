import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {AppState} from 'react-native'
import {PREFERENCE_KEYS} from '../../data'
import type {MobileScreenProps} from '../../navigation/types'
import type {ReaderHandle} from '../ReaderWebView'
import type {ReaderIdentity, Translate, WriteReaderPreferences} from './types'

/** Fallback for a native stack that never reports the end of the push transition. */
export const READER_TRANSITION_FALLBACK_MS = 600

export interface ReaderExitPorts {
  abort(): void
  persist(): void
  background(): void
  flushOutline(reason: 'background' | 'exit'): Promise<unknown>
  nativeFailure(reason: unknown, message: string): boolean
}
export function useReaderLifecycle(identity: ReaderIdentity, ports: {
  navigation: MobileScreenProps<'Reader'>['navigation']; routeKey: string; t: Translate
  isAccountActive(): boolean; writePreferences: WriteReaderPreferences
  /** Defers background status persistence while the push transition runs. */
  setInteractionBusy?(busy: boolean, source: string): void
}) {
  const {cacheKey, bookmarkId, collectionOwnerId, collectionId, isPreview} = identity
  const {navigation, routeKey, t, isAccountActive, writePreferences} = ports
  const setInteractionBusy = useRef(ports.setInteractionBusy); setInteractionBusy.current = ports.setInteractionBusy
  const mounted = useRef(true)
  const foreground = useRef(AppState.currentState == null || AppState.currentState === 'active')
  const reader = useRef<ReaderHandle | null>(null)
  const [appActive, setAppActive] = useState(foreground.current)
  const [routeVisible, setRouteVisible] = useState(() => navigation.isFocused())
  const [transitionReady, setTransitionReady] = useState(false)
  const routeFocused = useRef(routeVisible)
  const [operationError, setOperationError] = useState<string | null>(null)
  const pendingError = useRef<string | null>(null)
  const commands = useRef<ReaderExitPorts | null>(null)
  const title = useRef('')
  const fail = useCallback((reason: unknown) => {
    if (!mounted.current || !isAccountActive()) return
    if (reason && typeof reason === 'object' && (('name' in reason && (reason.name === 'AbortError' || reason.name === 'ReaderOperationCancelled' || reason.name === 'SessionChangedError')) || ('code' in reason && reason.code === 'E_READER_INACTIVE'))) return
    const message = reason instanceof Error ? reason.message : t('load_bookmark_content_error')
    if (commands.current?.nativeFailure(reason, message)) return
    if (foreground.current) setOperationError(message)
    else pendingError.current = message
  }, [t, isAccountActive])
  const clearError = useCallback(() => {pendingError.current = null; setOperationError(null)}, [])
  useLayoutEffect(() => {
    routeFocused.current = navigation.isFocused(); setRouteVisible(routeFocused.current)
    foreground.current = routeFocused.current && (AppState.currentState == null || AppState.currentState === 'active')
    const focus = navigation.addListener('focus', () => {
      routeFocused.current = true; setRouteVisible(true)
      foreground.current = AppState.currentState == null || AppState.currentState === 'active'
      if (foreground.current && pendingError.current && isAccountActive()) {setOperationError(pendingError.current); pendingError.current = null}
    })
    const blur = navigation.addListener('blur', () => {
      routeFocused.current = false; foreground.current = false; setRouteVisible(false)
      commands.current?.background(); commands.current?.persist(); void commands.current?.flushOutline('background').catch(fail)
    })
    return () => {focus(); blur()}
  }, [navigation, isAccountActive, fail])
  // Once the push has settled the document host stays mounted; a later pop or cancelled back gesture never unmounts it.
  useLayoutEffect(() => {
    if (transitionReady) return
    const routes = navigation.getState?.()?.routes
    if (!routes || routes[0]?.key === routeKey) {setTransitionReady(true); return}
    const source = `transition:${routeKey}`
    let busy = true
    const idle = () => {if (busy) {busy = false; setInteractionBusy.current?.(false, source)}}
    setInteractionBusy.current?.(true, source)
    const settle = () => {idle(); setTransitionReady(true)}
    const end = navigation.addListener('transitionEnd', event => {if (!event.data.closing) settle()})
    const cancel = navigation.addListener('gestureCancel', settle)
    const fallback = setTimeout(settle, READER_TRANSITION_FALLBACK_MS)
    return () => {clearTimeout(fallback); end(); cancel(); idle()}
  }, [navigation, routeKey, transitionReady])
  useEffect(() => {
    mounted.current = true
    return () => {mounted.current = false; commands.current?.abort(); commands.current?.persist(); void commands.current?.flushOutline('exit').catch(() => undefined)}
  }, [cacheKey, isAccountActive])
  useEffect(() => {
    let committed = false
    return navigation.addListener('state', event => {
      if (committed || event.data.state.routes.some(value => value.key === routeKey)) return
      committed = true; mounted.current = false
      commands.current?.abort(); commands.current?.persist()
      void reader.current?.commitExit().catch(fail)
      void commands.current?.flushOutline('exit').catch(fail)
    })
  }, [navigation, routeKey, fail])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active' && routeFocused.current; setAppActive(state === 'active')
      if (!foreground.current) commands.current?.background()
      else if (mounted.current && isAccountActive() && pendingError.current) {setOperationError(pendingError.current); pendingError.current = null}
    })
    return () => subscription.remove()
  }, [isAccountActive])
  useEffect(() => {
    void writePreferences(next => {delete next[PREFERENCE_KEYS.continueReading]}).catch(fail)
    const subscription = AppState.addEventListener('change', state => {
      if (!isAccountActive() || !routeFocused.current) return
      if (state === 'active') void writePreferences(next => {delete next[PREFERENCE_KEYS.continueReading]}).catch(fail)
      else {
        void commands.current?.flushOutline('background').catch(fail)
        if (title.current && !isPreview) void writePreferences(next => {next[PREFERENCE_KEYS.continueReading] = JSON.stringify({bookmarkId, title: title.current, collectionOwnerId: collectionOwnerId ?? null, collectionId: collectionId ?? null})}).catch(fail)
      }
    })
    return () => subscription.remove()
  }, [bookmarkId, collectionOwnerId, collectionId, isPreview, writePreferences, isAccountActive])
  return {mounted, foreground, reader, appActive, routeVisible, transitionReady, isAccountActive, fail, operationError, clearError, commands, title}
}
