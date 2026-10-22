import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {getNetworkStateAsync} from 'expo-network'
import {fixMarkdownLinks, jsonArray, StreamMarkdownProcessor} from '../model'
import {ReaderPositionWriter} from '../position'
import type {MobileContext, ReaderLocalSnapshot, ReaderScope, ReaderTelemetry} from './types'

import {FeatureState, type ReaderAiState as AiState} from './feature-state'
const emptyAi = (): AiState => ({content: '', takeaways: [], busy: false, pending: true, error: null})
interface AiPorts {
  api: Pick<MobileContext['api'], 'streamAi' | 'sendMetrics'>
  local: NonNullable<MobileContext['repositories']>['local'] | undefined
  network: NonNullable<MobileContext['fixtureOnly']>['network'] | undefined
  subscribed: boolean
  platform: string
  telemetry: ReaderTelemetry
  clearSelection(): void
  subscription(): void
  document: {documentReady: boolean; loading: boolean; html: string | null; contentError: string | null; isPdf: boolean; pdfTextState: string | null; pdfTextMessage: string | null}
}
export function useReaderAi(scope: ReaderScope, ports: AiPorts) {
  const {cacheKey, bookmarkId, isPreview, foreground, mounted, appActive, isAccountActive, fail, t, reader} = scope
  const {api, local, network: fixtureNetwork, subscribed, telemetry, clearSelection, document} = ports
  const {documentReady, loading, html, contentError, isPdf, pdfTextState, pdfTextMessage} = document
  const overview = useMemo(() => new FeatureState(emptyAi()), [cacheKey, isAccountActive])
  const outline = useMemo(() => new FeatureState(emptyAi()), [cacheKey, isAccountActive])
  const setOverview = overview.set, setOutline = outline.set
  useEffect(() => {overview.setVisible(scope.routeVisible !== false && appActive); outline.setVisible(scope.routeVisible !== false && appActive)}, [overview, outline, scope.routeVisible, appActive])
  const [outlineStatus, setOutlineStatus] = useState<'none' | 'hidden' | 'collapsed' | 'expanded'>('none')
  const requests = useRef(new Map<'overview' | 'outline', AbortController>())
  const started = useRef(false), position = useRef(0), hydration = useRef(0)
  const completedKinds = useRef(new Set<'overview' | 'outline'>())
  const writer = useMemo(() => new ReaderPositionWriter(value => isAccountActive() ? local?.update(cacheKey, {outline_read_position: String(Math.round(value))}) : undefined, fail), [local, cacheKey, isAccountActive])
  const abort = useCallback(() => {requests.current.forEach(controller => controller.abort()); requests.current.clear()}, [])
  const reset = useCallback(() => {abort(); started.current = false; completedKinds.current.clear(); setOverview(emptyAi()); setOutline(emptyAi()); setOutlineStatus('none')}, [abort, setOverview, setOutline])
  useLayoutEffect(() => {reset(); position.current = 0; hydration.current = 0}, [cacheKey, reset])
  useEffect(() => () => {abort(); void writer.dispose('exit').catch(() => undefined)}, [writer, abort])
  const hydrate = useCallback((snapshot: ReaderLocalSnapshot) => {
    if (snapshot.revision === hydration.current) return
    hydration.current = snapshot.revision
    const values = snapshot.values
    if (values.overview) completedKinds.current.add('overview')
    if (values.outline) completedKinds.current.add('outline')
    if (!requests.current.has('overview')) setOverview({content: String(values.overview ?? ''), takeaways: jsonArray<string>(values.key_takeaways), busy: false, pending: false, error: null})
    if (!requests.current.has('outline')) setOutline({content: fixMarkdownLinks(String(values.outline ?? '')), takeaways: [], busy: false, pending: !values.outline, error: null})
    position.current = Number(values.outline_read_position ?? 0)
  }, [setOverview, setOutline])
  const load = useCallback(async (kind: 'overview' | 'outline', force = false) => {
    if (!foreground.current || !bookmarkId || isPreview || !local || requests.current.has(kind) || !isAccountActive()) return
    const update = kind === 'overview' ? setOverview : setOutline
    if (completedKinds.current.has(kind) && !force) return
    completedKinds.current.delete(kind)
    if (isPdf && pdfTextState !== 'ready') {update(previous => ({...previous, busy: false, pending: false, error: pdfTextMessage})); return}
    const controller = new AbortController(); requests.current.set(kind, controller)
    let content = ''; let takeaways: string[] = []; const processor = new StreamMarkdownProcessor()
    let publishTimer: ReturnType<typeof setTimeout> | undefined
    let pending: AiState | null = null
    const publish = () => {
      publishTimer = undefined
      const next = pending; pending = null
      if (next && !controller.signal.aborted && mounted.current && isAccountActive()) update(next)
    }
    update(previous => ({...previous, busy: true, pending: !previous.content, error: null}))
    try {
      const network = fixtureNetwork ?? await getNetworkStateAsync()
      if (controller.signal.aborted || !isAccountActive()) return
      if (!network.isConnected || network.isInternetReachable === false) throw new Error('No network connection')
      let completed = false
      for await (const event of api.streamAi(kind, bookmarkId, controller.signal)) {
        if (controller.signal.aborted || !isAccountActive()) return
        if (event.type === 'error') throw new Error(event.message ?? t('outline_error'))
        if (kind === 'overview' && typeof event.data?.overview === 'string') content += event.data.overview
        if (kind === 'outline' && typeof event.data?.outline === 'string') content = processor.process(event.data.outline)
        if (event.data?.key_takeaways) takeaways = event.data.key_takeaways
        if (event.type === 'done' || event.data?.done) {completed = true; if (kind === 'outline') content = processor.flush()}
        pending = {content, takeaways, busy: !completed, pending: !content, error: null}
        if (completed) {
          if (publishTimer !== undefined) clearTimeout(publishTimer)
          publish()
          if (content) await local.update(cacheKey, kind === 'overview' ? {overview: content, key_takeaways: takeaways.length ? JSON.stringify(takeaways) : null} : {outline: content})
          if (!controller.signal.aborted && isAccountActive()) completedKinds.current.add(kind)
          break
        }
        if (publishTimer === undefined) publishTimer = setTimeout(publish, 80)
      }
      if (!completed && !controller.signal.aborted) throw new Error(t('outline_error'))
    } catch (error) {
      if (publishTimer !== undefined) clearTimeout(publishTimer)
      publish()
      if (!controller.signal.aborted && mounted.current && isAccountActive()) update(previous => ({...previous, busy: false, error: error instanceof Error ? error.message : t('outline_error')}))
    } finally {
      if (publishTimer !== undefined) clearTimeout(publishTimer)
      pending = null
      if (requests.current.get(kind) === controller) requests.current.delete(kind)
    }
  }, [api, bookmarkId, cacheKey, isPreview, local, overview, outline, fixtureNetwork, isAccountActive, isPdf, pdfTextState, pdfTextMessage])
  useEffect(() => {
    if (documentReady && appActive && scope.routeVisible !== false && scope.transitionReady !== false && !loading && (html || pdfTextState === 'ready') && !contentError && !isPreview && !started.current) {started.current = true; void load('overview'); void load('outline')}
  }, [documentReady, appActive, scope.routeVisible, scope.transitionReady, loading, html, pdfTextState, contentError, isPreview, load])
  useEffect(() => {
    if (appActive && scope.routeVisible !== false && (!isPdf || pdfTextState === 'ready')) return
    abort(); started.current = false
    setOverview(previous => ({...previous, busy: false})); setOutline(previous => ({...previous, busy: false}))
  }, [isPdf, appActive, scope.routeVisible, pdfTextState, abort, setOverview, setOutline])
  useEffect(() => {if (subscribed && !isPreview) setOutlineStatus(status => status === 'none' ? 'collapsed' : status)}, [subscribed, isPreview])
  const open = () => {
    if (!isAccountActive()) return
    clearSelection(); telemetry.element('detail_outline_button', 'detail'); telemetry.firebase('bookmark', 'use_outline', {is_subscribed: subscribed})
    if (!subscribed) {ports.subscription(); return}
    setOutlineStatus('expanded'); void api.sendMetrics('ai_summary').catch(fail); void load('outline')
  }
  const expand = () => {if (!isAccountActive()) return; clearSelection(); telemetry.firebase('outline', 'interact', {}, outlineStatus === 'collapsed' ? 'expand' : 'open'); setOutlineStatus('expanded'); if (isPdf) void load('outline')}
  const close = (status: 'hidden' | 'collapsed') => {
    telemetry.firebase('outline', 'interact', {}, status === 'hidden' ? 'close' : 'collapse')
    setOutlineStatus(status); clearSelection(); void writer.flush('background').catch(fail)
  }
  const link = (href: string) => {if (href.startsWith('#')) {setOutlineStatus('collapsed'); void reader.current?.scrollToAnchor(href.slice(1)).catch(fail)}}
  const updatePosition = (value: number) => {if (isAccountActive()) {position.current = value; writer.update(value)}}
  return {overview, outline, outlineStatus, position, load, hydrate, abort, reset, documentChanged: () => {started.current = false}, open, expand, close, link, updatePosition,
    flush: (reason: 'background' | 'exit') => reason === 'exit' ? writer.dispose(reason) : writer.flush(reason)}
}
