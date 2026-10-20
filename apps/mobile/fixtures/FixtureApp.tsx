import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Dimensions, Linking, PixelRatio, Platform, StatusBar, Text, View, useColorScheme, useWindowDimensions} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider, useSafeAreaInsets} from 'react-native-safe-area-context';
import {File} from 'expo-file-system';
import {requireNativeModule} from 'expo';
import {ApplicationRoutes, navigationRef} from '../src/App';
import {FixtureMobileProvider, type MobileContextValue} from '../src/runtime';
import {mobileColors} from '../src/theme';
import {fixtureActions, type FixtureAction} from '../src/components/fixture-actions';
import {createFixtureRuntime, type FixturePayload} from './runtime';
import bundleJson from './scenarios.json';
import manifestJson from './manifest.json';
import {parseFixtureCommand} from './commands';

interface FixtureScenario {route: {name: string; params?: Record<string, unknown>}; payload: FixturePayload; actions: Record<string, unknown>[]}
const bundle = bundleJson as unknown as {schemaVersion: number; scenarios: Record<string, FixtureScenario>};
export interface FixtureControl {
  scenario: string; locale: 'en'|'zh'; inputSha256: string; scopeUri: string;
  plannedActions: Record<string, unknown>[];
  perform(action: FixtureAction | number): Promise<{handler: string; nativeInteractionVerified: false}>;
  setSync(state: FixturePayload['sync']): void;
  setNetwork(state: FixturePayload['network']): Promise<void>;
  setLocale(locale: 'en'|'zh'): Promise<void>;
  selectCase(scenario: string, locale: 'en'|'zh'): void;
  captureContext(): Promise<unknown>;
}
declare global {var __SLAX_UI_FIXTURE__: FixtureControl | undefined;}

interface NativeMeasurements {
  platform: string; osVersion: string; deviceModel?: string; appearance: string | null;
  viewport: ReturnType<typeof Dimensions.get>; screen: ReturnType<typeof Dimensions.get>;
  pixelRatio: number; fontScale: number; fontScaleProfile: string;
  safeArea: {top: number; bottom: number; left: number; right: number};
}
/** Read native layout measurements without adding any fixture UI. */
function CaptureMeasurements({onMeasure}: {onMeasure(value: NativeMeasurements): void}) {
  const viewport = useWindowDimensions(), safeArea = useSafeAreaInsets(), appearance = useColorScheme();
  useEffect(() => {
    const constants = Platform.constants;
    onMeasure({platform: Platform.OS, osVersion: Platform.OS === 'android' ? Platform.constants.Release : Platform.OS === 'ios' ? Platform.constants.osVersion : String(Platform.Version),
      ...('Model' in constants ? {deviceModel: String(constants.Model)} : {}),
      viewport, screen: Dimensions.get('screen'), pixelRatio: PixelRatio.get(), fontScale: viewport.fontScale,
      fontScaleProfile: viewport.fontScale > 1 ? 'accessibility-enlarged' : 'default', safeArea, appearance});
  }, [onMeasure, viewport, safeArea, appearance]);
  return null;
}

/** Separate development entry: production App never constructs this synthetic runtime. */
export default function FixtureApp() {
  if (!__DEV__) throw new Error('UI fixtures cannot run in a production build');
  const [scenarioName, setScenarioName] = useState(process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE || 'library-populated');
  const [locale, setLocale] = useState(process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE_LOCALE || 'en');
  const [generation, setGeneration] = useState(0);
  const scenario = bundle.scenarios[scenarioName];
  const [prepared, setPrepared] = useState<{scenarioName: string; locale: string; generation: number; value: MobileContextValue} | null>(null), [error, setError] = useState('');
  // Unmount the previous routes in the same render that selects another case.
  const context = prepared && prepared.scenarioName === scenarioName && prepared.locale === locale && prepared.generation === generation ? prepared.value : null;
  const run = useRef<Awaited<ReturnType<typeof createFixtureRuntime>> | null>(null);
  const measurements = useRef<NativeMeasurements | null>(null), record = useRef<(() => void) | undefined>(undefined);
  const onMeasure = useCallback((value: NativeMeasurements) => {measurements.current = value; record.current?.();}, []);
  useEffect(() => {
    const handle = async (url: string) => {
      try {
        const command = parseFixtureCommand(url, bundle.scenarios);
        if (!command) return;
        if (command.kind === 'case') {setScenarioName(command.scenario); setLocale(command.locale); setGeneration(value => value + 1); return;}
        const control = globalThis.__SLAX_UI_FIXTURE__;
        if (!control) throw new Error('Fixture has not finished preparing');
        await control.perform(command.action);
      } catch {console.warn('Controlled fixture command failed; inspect fixture command diagnostics.');}
    };
    const stop = Linking.addEventListener('url', event => {void handle(event.url);});
    void Linking.getInitialURL().then(url => {if (url) void handle(url);});
    return () => stop.remove();
  }, []);
  useEffect(() => {
    let active = true, revision = 0;
    setPrepared(null); setError('');
    if (!scenario || bundle.schemaVersion !== 1) {setError('Unknown or incompatible fixture scenario'); return;}
    const digest = manifestJson.files.find(file => file.path === 'scenarios.json')!.sha256;
    const payload = JSON.parse(JSON.stringify(scenario.payload)) as FixturePayload;
    // The approved development client is already bundled. Remove its visual overlays only in this isolated entry.
    if (Platform.OS === 'ios') void requireNativeModule<{setPreferencesAsync(settings: Record<string, boolean>): Promise<void>}>('DevMenuPreferences').setPreferencesAsync({showFloatingActionButton: false, showsAtLaunch: false}).catch(reason => {if (active) setError(String(reason));});
    const refresh = async () => {const adapter = run.current; if (!active || !adapter) return; const stamp = ++revision, value = await adapter.value(); if (active && stamp === revision) setPrepared({scenarioName, locale, generation, value});};
    let subscriptions: (() => void)[] = [], stopActions: (() => void) | undefined;
    void createFixtureRuntime(scenarioName, payload, digest, locale).then(async adapter => {
      if (!active) {await adapter.dispose(); return;}
      run.current = adapter;
      stopActions = fixtureActions.activate(adapter.scopeUri);
      subscriptions = [adapter.preferences.subscribe(() => {void refresh();}), adapter.sessions.subscribe(() => {void refresh();})];
      const preparedActions: {action: FixtureAction; handler: string; nativeInteractionVerified: false}[] = [];
      let observedPreferenceValues: Record<string, unknown> | null = null;
      const recordContext = () => new File(adapter.scopeUri, 'render-context.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, scenario: scenarioName, inputSha256: digest, locale: payload.settings.user_language, observedPreferenceValues, nativeMeasurements: measurements.current, observedRoute: navigationRef.isReady() ? navigationRef.getCurrentRoute() : null, observedNavigationState: navigationRef.isReady() ? {root: navigationRef.getRootState(), canGoBack: navigationRef.canGoBack()} : null, rssDatabasePersistence: adapter.rssDatabasePersistence, measuredAt: new Date().toISOString(), displayedClock: 'pending-native-frame-inspection', simulatedNetworkAndSync: true, nativeExecution: 'pending-capture', preparedActions, sourceParity: 'unverified'}));
      record.current = recordContext;
      globalThis.__SLAX_UI_FIXTURE__ = {scenario: scenarioName, locale: payload.settings.user_language as 'en'|'zh', inputSha256: digest, scopeUri: adapter.scopeUri, plannedActions: scenario.actions, setSync: adapter.setSync,
        async captureContext() {if (!active) throw new Error('Fixture scope was disposed'); const current = await adapter.preferences.read(); if (!active) throw new Error('Fixture scope was disposed'); observedPreferenceValues = {cache_count: current.cache_count, download_images: current.download_images, user_language: current.user_language}; recordContext(); const raw = await new File(adapter.scopeUri, 'render-context.json').text(); if (!active) throw new Error('Fixture scope was disposed'); return JSON.parse(raw);},
        selectCase(next, nextLocale) {if (!Object.hasOwn(bundle.scenarios, next) || !['en', 'zh'].includes(nextLocale)) throw new Error('Unknown prepared fixture case or locale'); setScenarioName(next); setLocale(nextLocale); setGeneration(value => value + 1);},
        async perform(input) {
          try {
            if (!active) throw new Error('Fixture scope was disposed');
            const action = (typeof input === 'number' ? scenario.actions[input] : input) as FixtureAction;
            if (!action) throw new Error('Unknown fixture action index');
            const handler = action.kind === 'delete-bookmark' ? (await adapter.deleteBookmark(String(action.id)), 'fixture-runtime') : await adapter.perform(action);
            if (!active) throw new Error('Fixture scope was disposed');
            const result = {handler, nativeInteractionVerified: false as const}; preparedActions.push({action, ...result}); recordContext(); return result;
          } catch (reason) {
            const name = reason && typeof reason === 'object' && 'name' in reason ? reason.name : '';
            const code = name === 'AbortError' || name === 'FixtureControlDisposed' ? 'interrupted' : 'failed';
            if (active) new File(adapter.scopeUri, 'command-error.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, code, nativeInteractionVerified: false}));
            throw new Error(`Fixture command ${code}; inspect command-error.json`);
          }
        },
        async setNetwork(next) {payload.network = next; await refresh();},
        async setLocale(next) {payload.settings.user_language = next; await adapter.preferences.update(values => {values.user_language = next;}); await refresh(); recordContext();},
      };
      recordContext();
      await refresh();
    }).catch(reason => {if (active) setError(reason instanceof Error ? reason.message : 'Unable to prepare isolated fixtures');});
    return () => {active = false; record.current = undefined; subscriptions.forEach(stop => stop()); stopActions?.(); globalThis.__SLAX_UI_FIXTURE__ = undefined; const adapter = run.current; run.current = null; void adapter?.dispose();};
  }, [scenarioName, locale, generation]);
  useEffect(() => {
    if (!context || scenario?.route.name === 'Library' || scenario?.route.name === 'Login' || context.upgrade.status !== 'ready') return;
    const timer = setInterval(() => {
      if (!navigationRef.isReady()) return; clearInterval(timer);
      navigationRef.resetRoot({index: 1, routes: [{name: 'Library'}, {name: scenario.route.name, params: scenario.route.params}]});
    }, 50);
    return () => clearInterval(timer);
  }, [context?.runtime]);
  return <GestureHandlerRootView style={{flex: 1}}><SafeAreaProvider><StatusBar barStyle="dark-content"/>
    <CaptureMeasurements onMeasure={onMeasure}/>
    {error ? <View style={{flex: 1, padding: 24, justifyContent: 'center', backgroundColor: mobileColors.background}}><Text selectable>{error}</Text></View> : context ? <FixtureMobileProvider value={context}><ApplicationRoutes/></FixtureMobileProvider> : <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: mobileColors.background}}><ActivityIndicator color={mobileColors.accent}/></View>}
  </SafeAreaProvider></GestureHandlerRootView>;
}
