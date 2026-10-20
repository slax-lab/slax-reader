import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {AppState, Pressable, ScrollView, Text, View} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {createWidgetNativeBoundary} from '../src/widgets/native-boundary';
import {WidgetRuntimeCoordinator} from '../src/widgets/runtime-coordinator';
import {SystemEntryRouter, type SystemEntryReceipt} from '../src/system-actions/entry-router';
import type {WidgetRouteMap} from '../src/widgets/route-map';
import type {WidgetOwner} from '../src/widgets/controller';
import type {MobileRepositories} from '../src/data/repositories';
import type {WidgetLibrarySnapshot} from '../src/data/repositories/types';

const fixtureOwner: WidgetOwner = {userId: 'synthetic-widget-fixture', origin: 'https://widget-fixture.test', generation: 'fixture-only-1'};
const ownerKey = JSON.stringify([fixtureOwner.userId, fixtureOwner.origin]);
const seed = () => [1, 2, 3].map(number => ({id: `fixture-widget-${number}`, title: `FIXTURE article ${number}`, savedAt: 4 - number, read: false}));

/** Real native surfaces, synthetic memory-only data. Never constructs a production account runtime. */
function createFixtureSession() {
  if (!__DEV__) throw new Error('Widget native fixture is development-only');
  const boundary = createWidgetNativeBoundary();
  if (!boundary) throw new Error('The main development client must include SlaxWidgetBridge');
  let rows = seed(), admitted = true, titles = true, routeMap: WidgetRouteMap = {owner: '', ids: {}};
  let receipts: SystemEntryReceipt[] = [], onRows: ((value: WidgetLibrarySnapshot) => void) | undefined;
  let sequence = 0, disposed = false;
  let state = {message: 'Synthetic fixture ready', unread: 3, admitted, titles};
  const listeners = new Set<() => void>();
  const report = (message: string) => {if (disposed) return; state = {message, unread: rows.filter(row => !row.read).length, admitted, titles}; listeners.forEach(listener => listener());};
  const emitRows = () => {onRows?.({unreadCount: rows.filter(row => !row.read).length, suggestions: rows.filter(row => !row.read).slice(0, 3)});};
  const repositories = {watchWidgetSnapshot(listener: (value: WidgetLibrarySnapshot) => void) {onRows = listener; emitRows(); return () => {if (onRows === listener) onRows = undefined;};}} as MobileRepositories;
  const coordinator = new WidgetRuntimeCoordinator(boundary, async value => {routeMap = value;}, async (owner, id) => {
    if (!admitted || owner.generation !== fixtureOwner.generation || owner.userId !== fixtureOwner.userId || owner.origin !== fixtureOwner.origin) throw new Error('Fixture owner changed');
    const row = rows.find(row => row.id === id);
    if (!row) throw new Error('Fixture item is unavailable');
    row.read = true; emitRows(); report(`Marked ${row.title} read`);
  });
  const router = new SystemEntryRouter({
    async read() {return receipts;}, async write(value) {receipts = value;},
    currentOwner: () => admitted ? fixtureOwner : null,
    ready: () => admitted && !disposed,
    async getBookmark(id) {
      const local = routeMap.owner === ownerKey ? routeMap.ids[id] : undefined;
      const row = rows.find(row => row.id === local);
      return row && admitted ? {id: row.id, title: row.title, aliasTitle: '', url: 'https://widget-fixture.test/article', status: 'success', createdAt: '2026-10-20T00:00:00Z', archiveStatus: 0} : null;
    },
    navigate(id) {report(`Guard opened ${rows.find(row => row.id === id)?.title ?? 'unavailable fixture'}`);},
    async removeInvocation() {}, async donate() {},
  });
  const configure = () => {coordinator.configure(admitted ? fixtureOwner : null, admitted ? repositories : null, {titlesEnabled: titles, countEnabled: true}); void router.contextChanged();};
  const receive = (id: string) => {
    if (!admitted) report('Guard waiting: fixture owner is signed out');
    void router.receive([{id: `fixture-widget-tap-${++sequence}`, name: 'openBookmark', params: {bookmarkId: id}, createdAt: Date.now()}]).catch(() => report('Fixture route failed'));
  };
  coordinator.activate(); router.activate(); configure();
  const stopRoute = boundary.addRouteListener?.(receive);
  void boundary.getInitialRoute?.().then(id => {if (id && !disposed) receive(id);}).catch(() => report('Initial fixture route unavailable'));
  const stopRouter = router.subscribe(receipt => {if (receipt?.status === 'unavailable') report('Guard blocked: stale or removed fixture item');});
  const appState = AppState.addEventListener('change', value => coordinator.foreground(value === 'active'));
  return {
    coordinator, subscribe(listener: () => void) {listeners.add(listener); return () => listeners.delete(listener);}, getSnapshot: () => state,
    async action(name: 'start' | 'stop' | 'read' | 'reset' | 'clear' | 'owner' | 'titles' | 'refresh') {
      if (disposed) return;
      if (name === 'start') {report(await coordinator.startReadingSession(3, 10 * 60_000) ? 'Fixture Live Activity requested' : 'Fixture Live Activity unavailable'); return;}
      if (name === 'stop') {await coordinator.stopReadingSession(); report('Fixture Live Activity ended'); return;}
      if (name === 'read') {const first = rows.find(row => !row.read); if (!first || !await coordinator.markRead(first.id)) report('Start a fixture session before marking an unread item'); return;}
      if (name === 'reset' || name === 'clear') {await coordinator.stopReadingSession(); rows = name === 'reset' ? seed() : []; emitRows(); report(name === 'reset' ? 'Synthetic queue reset' : 'Synthetic queue cleared'); return;}
      if (name === 'owner') {admitted = !admitted; configure(); report(admitted ? 'Fixture owner restored' : 'Fixture owner revoked; OS data redacted'); return;}
      if (name === 'titles') {titles = !titles; configure(); report(titles ? 'Fixture titles enabled' : 'Fixture count-only mode'); return;}
      await coordinator.retry(); coordinator.foreground(true); report('Fixture refresh requested');
    },
    dispose() {disposed = true; stopRoute?.remove(); stopRouter(); appState.remove(); router.dispose(); coordinator.dispose(); listeners.clear();},
  };
}

function Controls({session}: {session: ReturnType<typeof createFixtureSession>}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const status = useSyncExternalStore(session.coordinator.subscribe, session.coordinator.getSnapshot, session.coordinator.getSnapshot);
  const [error, setError] = useState('');
  const actions = [['start', 'Start fixture session'], ['stop', 'End fixture session'], ['read', 'Mark first fixture item read'], ['reset', 'Reset synthetic queue'], ['clear', 'Clear synthetic queue'], ['titles', state.titles ? 'Use count-only fixture' : 'Show fixture titles'], ['owner', state.admitted ? 'Revoke fixture owner' : 'Restore fixture owner'], ['refresh', 'Refresh native surfaces']] as const;
  return <ScrollView contentContainerStyle={{padding: 20, gap: 14}}>
    <Text style={{fontSize: 21, fontWeight: '600'}}>Widget / Live Activity FIXTURE</Text>
    <Text>Synthetic memory-only account and articles. Real WidgetKit / ActivityKit bridge. This does not verify production login, API data or admission.</Text>
    <Text accessibilityLiveRegion="polite">{state.message}</Text>
    <Text>Unread: {state.unread}; session: {status.activityActive ? 'active' : 'inactive'}; native failure: {status.failed ? 'yes' : 'no'}</Text>
    <Text>OS widget taps use the production entry-router controller with synthetic admission and an isolated in-memory map. No production Reader navigation or donation occurs.</Text>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {actions.map(([name, label]) => <Pressable key={name} accessibilityRole="button" accessibilityLabel={label} onPress={() => {setError(''); void session.action(name).catch(() => setError('Fixture native operation failed'));}} style={{padding: 14, borderWidth: 1, borderColor: '#777', borderRadius: 8}}><Text>{label}</Text></Pressable>)}
  </ScrollView>;
}

export default function WidgetNativeFixture() {
  const [session, setSession] = useState<ReturnType<typeof createFixtureSession> | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let owned: ReturnType<typeof createFixtureSession> | undefined;
    try {owned = createFixtureSession(); setSession(owned);} catch {setError('Widget fixture needs the main native development client with widget support');}
    return () => owned?.dispose();
  }, []);
  return <SafeAreaProvider><SafeAreaView style={{flex: 1, backgroundColor: '#fff'}}>{session ? <Controls session={session}/> : <View style={{padding: 24}}><Text>{error || 'Preparing synthetic native fixture'}</Text></View>}</SafeAreaView></SafeAreaProvider>;
}
