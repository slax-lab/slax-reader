import {useCallback, useEffect, useLayoutEffect, useRef} from 'react'
import {File} from 'expo-file-system'
import {fixtureActions} from '../../components/fixture-actions'
import type {MobileScreenProps} from '../../navigation/types'
import type {useControlledUpgradeReaderObserver} from '../../runtime'
import {readerInputEventCode} from '../input'
import type {ReaderInputObservation} from '../input'
import {sourceStableId} from '../model'
import type {ReaderFixtureLifecycle, ReaderObservation} from '../ReaderWebView'
import type {ReaderEvent, ReaderFixtureCommand} from '../types'
import type {MobileContext, ReaderScope} from '../state/types'

type FixtureLifecycle = ReaderFixtureLifecycle | {kind: 'native-transition-start' | 'native-transition-end' | 'native-gesture-cancel'; pageId: string; routeKey: string; closing?: boolean}
  | {kind: 'position-persisted'; pageId: string; reason: string; requestedPixels: number; persistedPixels: number | null}
interface DiagnosticPorts {
  fixtureOnly: MobileContext['fixtureOnly']
  observer: ReturnType<typeof useControlledUpgradeReaderObserver>
  navigation: MobileScreenProps<'Reader'>['navigation']
  routeKey: string
  local: NonNullable<MobileContext['repositories']>['local'] | undefined
  selection: {y: number; text: string} | null
  showOverview(): void; openOutline(): void; loadAi(kind: 'overview' | 'outline', force: boolean): Promise<void>
  showTranscript(): void; closeTranscript(): void; saveRss(): Promise<void>; flushOutline(): Promise<unknown>
}
export function useReaderDiagnostics(scope: ReaderScope, ports: DiagnosticPorts) {
  const {cacheKey, reader, isAccountActive} = scope
  const {fixtureOnly, observer, navigation, routeKey, local, selection} = ports
  const controlledFixture = Boolean(__DEV__ && fixtureOnly), fixtureDirectory = fixtureOnly?.dataDirectory
  const lifecycle = useRef<(FixtureLifecycle & {observedAt: number})[]>([]), input = useRef<(ReaderInputObservation & {observedAt: number})[]>([])
  useLayoutEffect(() => {lifecycle.current = []; input.current = []}, [cacheKey])
  const observe = useCallback((observation: ReaderObservation) => {
    if (!__DEV__) return
    try {observer?.({...observation, cacheKey, routeKey, observedAt: Date.now()})} catch {}
    if (observation.type !== 'input' || !controlledFixture || !fixtureDirectory?.includes('/slax-ui-fixtures/')) return
    try {
      const marker = JSON.parse(new File(fixtureDirectory, 'slax-fixture.json').textSync())
      if (marker.controlledFixture !== true || marker.fixtureVersion !== 1) return
      input.current.push({...observation.event, observedAt: Date.now()})
      if (input.current.length > 128) input.current.shift()
      new File(fixtureDirectory, 'reader-input.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, cacheKey, events: input.current}))
    } catch {}
  }, [observer, cacheKey, routeKey, controlledFixture, fixtureDirectory])
  const record = useCallback((event: FixtureLifecycle) => {
    if (!__DEV__ || !controlledFixture || !fixtureDirectory?.includes('/slax-ui-fixtures/')) return
    const marker = JSON.parse(new File(fixtureDirectory, 'slax-fixture.json').textSync())
    if (marker.controlledFixture !== true || marker.fixtureVersion !== 1) throw new Error('Fixture lifecycle scope is not controlled')
    lifecycle.current.push({...event, observedAt: Date.now()})
    if (lifecycle.current.length > 128) lifecycle.current.shift()
    new File(fixtureDirectory, 'reader-lifecycle.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, cacheKey, events: lifecycle.current}))
  }, [controlledFixture, fixtureDirectory, cacheKey])
  useEffect(() => {
    if (!controlledFixture) return
    const transition = (kind: 'native-transition-start' | 'native-transition-end' | 'native-gesture-cancel', closing?: boolean) => {
      const pages = lifecycle.current.filter(event => event.kind === 'mount'), page = pages[pages.length - 1]
      if (page) record({kind, pageId: page.pageId, routeKey, ...(closing === undefined ? {} : {closing})})
    }
    const removeStart = navigation.addListener('transitionStart', event => transition('native-transition-start', event.data.closing))
    const removeEnd = navigation.addListener('transitionEnd', event => transition('native-transition-end', event.data.closing))
    const removeCancel = navigation.addListener('gestureCancel', () => transition('native-gesture-cancel'))
    return () => {removeStart(); removeEnd(); removeCancel()}
  }, [controlledFixture, navigation, record, routeKey])
  const positionPersisted = async (position: number, reason: string, pageId?: string) => {
    if ((!observer && !controlledFixture) || !isAccountActive() || !local) return
    try {
      const row = await local.read(cacheKey)
      const persistedPixels = typeof row.read_position === 'string' && Number.isFinite(Number(row.read_position)) ? Number(row.read_position) : null
      if (observer && pageId && isAccountActive()) observer({type: 'position-persisted', pageId, reason, requestedPixels: position, persistedPixels, cacheKey, routeKey, observedAt: Date.now()})
      if (controlledFixture && isAccountActive()) {
        const pages = lifecycle.current.filter(event => event.kind === 'mount'), page = pages[pages.length - 1]
        if (page) record({kind: 'position-persisted', pageId: page.pageId, reason, requestedPixels: position, persistedPixels})
      }
    } catch {}
  }
  const event = (value: ReaderEvent, pageId: string) => {
    const eventCode = readerInputEventCode(value.type)
    if (eventCode && (observer || controlledFixture)) observe({type: 'input', event: {pageId, stage: 'screen', eventCode, markValid: 'mark' in value && value.mark !== null, accountActive: isAccountActive()}})
  }
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return
    return fixtureActions.subscribe('reader', async action => {
      if (action.kind === 'selection') {
        if (!reader.current || !Array.isArray(action.source)) throw new Error('Fixture reader selection is not ready')
        await reader.current.prepareFixture({kind: 'selection', source: action.source as Extract<ReaderFixtureCommand, {kind: 'selection'}>['source'], ...(typeof action.selectedText === 'string' ? {selectedText: action.selectedText} : {})})
      } else if (action.kind === 'open-comment') {
        if (!reader.current || typeof action.markId !== 'string') throw new Error('Fixture reader mark is not ready')
        await reader.current.prepareFixture({kind: 'open-comment', markId: sourceStableId(action.markId)})
      } else if (action.kind === 'open-image') {
        if (!reader.current || typeof action.imageId !== 'string') throw new Error('Fixture reader image is not ready')
        await reader.current.prepareFixture({kind: 'open-image', imageId: action.imageId})
      } else if (action.kind === 'scroll') {
        if (!reader.current || typeof action.target !== 'string' || !action.target.startsWith('#') || !await reader.current.scrollToAnchor(action.target.slice(1))) throw new Error('Fixture reader anchor did not resolve')
      } else if (action.kind === 'open-overview') ports.showOverview()
      else if (action.kind === 'open-outline') ports.openOutline()
      else if (action.kind === 'generate-overview') await ports.loadAi('overview', true)
      else if (action.kind === 'generate-outline') await ports.loadAi('outline', true)
      else if (action.kind === 'open-transcript') ports.showTranscript()
      else if (action.kind === 'tap-cue') {
        if (!reader.current || typeof action.seconds !== 'number' || await reader.current.queryYoutubeTime() < 0) throw new Error('A prepared YouTube player is required for fixture cue playback')
        ports.closeTranscript(); await reader.current.seekYoutube(action.seconds)
      } else if (action.kind === 'save-rss') await ports.saveRss()
      else if (action.kind === 'background-flush') {await reader.current?.flushPosition('background'); await ports.flushOutline()}
      else if (action.kind === 'inspect-position' || action.kind === 'inspect-selection') {
        if (!reader.current || !fixtureOnly.dataDirectory.includes('/slax-ui-fixtures/')) throw new Error('Fixture reader is not ready')
        const marker = JSON.parse(await new File(fixtureOnly.dataDirectory, 'slax-fixture.json').text())
        if (marker.controlledFixture !== true || marker.fixtureVersion !== 1) throw new Error('Fixture observation scope is not controlled')
        if (action.kind === 'inspect-position') new File(fixtureOnly.dataDirectory, 'reader-position.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, cacheKey, ...reader.current.inspectFixturePosition()}))
        else {
          const monitor = await reader.current.prepareFixture({kind: 'inspect-selection'}), captured = await reader.current.captureSelection()
          new File(fixtureOnly.dataDirectory, 'reader-selection.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, cacheKey,
            applicationSelection: selection ? {containerYPoints: selection.y, textLength: selection.text.length} : null, monitor,
            captured: captured ? {textLength: captured.text.length, paths: captured.source.length} : null, position: reader.current.inspectFixturePosition()}))
        }
      } else return false
      return true
    })
  })
  return {event, positionPersisted, onObservation: observer || controlledFixture ? observe : undefined, onFixtureLifecycle: controlledFixture ? record : undefined}
}
