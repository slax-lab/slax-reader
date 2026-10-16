import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, AppState, Platform, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {fetch} from 'expo/fetch';
import {Accelerometer} from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import type {SyncStatus} from '@powersync/common';
import {useMobile} from '../runtime';
import {resolveDns, systemInfo} from '../native/platform';
import {Divider, SourceButton, SourceDialog, SourceIcon, SourceSheet, SourceText, TextAction, ScreenSurface} from '../components';
import {SourceRing} from '../components/SourceRing';
import {CacheMaintenance, cacheCategories, emptyCacheUsage, formatCacheSize, nonEmptyCacheCategories, totalCacheBytes, type CacheCategory, type CacheUsage} from '../data/cache-maintenance';
import {createShakeDetector} from '../debug/shake';
import {mobileColors as C} from '../theme';
import type {MobileScreenProps} from '../navigation/types';
import {linkedAbortTimeout} from '../utils/abort';

interface Diagnostic {name: string; status: 'idle'|'testing'|'success'|'failed'; message: string}
type MaintenanceState = 'idle' | 'refreshing' | 'clearing';
const names = ['Public IP (cip.cc)', 'Public IP (Cloudflare)', 'Google DNS', 'Slax API', 'DNS (System)', 'DNS (8.8.8.8)', 'DNS (1.1.1.1)', 'PowerSync'];
const categoryColors = {article: '#B45837', images: '#16A085', other: '#D39B35'} as const;
const categoryKeys = {article: 'articles', images: 'images', other: 'other'} as const;
const resultColors = {idle: '#BDBDBD', testing: '#FFA726', success: '#4CAF50', failed: '#E53935'} as const;
const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export function DebugScreen({navigation}: MobileScreenProps<'Debug'>) {
  const {runtime, config, preferences, settings, repositories, cache, t, fixtureOnly} = useMobile();
  const database = runtime.getDatabase(), [sync, setSync] = useState<SyncStatus | undefined>(database?.currentStatus);
  const [info, setInfo] = useState<Record<string,string>>({}), [results, setResults] = useState<Diagnostic[]>(names.map(name => ({name, status: 'idle', message: ''})));
  const [testing, setTesting] = useState(false), [environment, setEnvironment] = useState(false), [restart, setRestart] = useState(false);
  const [usage, setUsage] = useState<CacheUsage>(emptyCacheUsage), [maintenanceState, setMaintenanceState] = useState<MaintenanceState>('idle');
  const [cleanup, setCleanup] = useState(false), [selected, setSelected] = useState<CacheCategory[]>([]), [snackbar, setSnackbar] = useState('');
  const maintenance = useMemo(() => repositories && cache ? new CacheMaintenance(repositories.database, cache) : null, [repositories, cache]);
  const running = useRef(false), stopped = useRef(false), cacheBusy = useRef(false), changedSelection = useRef(false), requestAbort = useRef<AbortController | null>(null);
  const selectedBytes = totalCacheBytes(usage, selected), total = totalCacheBytes(usage), busy = maintenanceState !== 'idle';
  function update(index: number, status: Diagnostic['status'], message: string) {if (!stopped.current) setResults(rows => rows.map((row, position) => position === index ? {...row, status, message} : row));}
  async function runAll() {
    if (running.current) return; running.current = true; setTesting(true);
    const controller = new AbortController(); requestAbort.current = controller;
    const host = new URL(config.apiUrl).hostname;
    const request = async (url: string) => {
      if (fixtureOnly) throw new Error('Diagnostic networking is disabled in controlled UI fixtures');
      const request = linkedAbortTimeout(10000, controller.signal);
      try {
        const response = await fetch(url, {signal: request.signal});
        if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.text();
      } finally {request.cleanup();}
    };
    const checks = [
      async () => (await request('http://cip.cc')).split('\n').find(line => line.startsWith('IP'))?.split(':').slice(1).join(':').trim() ?? 'Unknown',
      async () => (await request('https://www.cloudflare.com/cdn-cgi/trace')).split('\n').find(line => line.startsWith('ip='))?.slice(3) ?? 'Unknown',
      async () => {await request('https://dns.google'); return 'Connected';},
      async () => {await request(`${config.apiUrl}/ping`); return 'Connected';},
      () => fixtureOnly ? Promise.reject(new Error('Fixture DNS is disabled')) : resolveDns(host), () => fixtureOnly ? Promise.reject(new Error('Fixture DNS is disabled')) : resolveDns(host, '8.8.8.8'), () => fixtureOnly ? Promise.reject(new Error('Fixture DNS is disabled')) : resolveDns(host, '1.1.1.1'),
      async () => {
        const deadline = Date.now() + 10000;
        while (!controller.signal.aborted && Date.now() < deadline) {
          const state = database?.currentStatus;
          if (state?.connected) return 'Connected';
          const error = state?.downloadError ?? state?.uploadError; if (error) throw error;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error('Connection timed out');
      },
    ];
    try {
      for (let index = 0; index < checks.length && !controller.signal.aborted; index++) {
        update(index, 'testing', 'Testing...'); const start = Date.now();
        try {const message = await checks[index]!(); update(index, 'success', `${message} (${Date.now() - start}ms)`);}
        catch (error) {if (!controller.signal.aborted) update(index, 'failed', error instanceof Error ? error.message : 'Connection failed');}
      }
    } finally {running.current = false; if (!stopped.current) setTesting(false);}
  }
  async function refreshUsage() {
    if (!maintenance || cacheBusy.current) return; cacheBusy.current = true; setMaintenanceState('refreshing');
    try {const next = await maintenance.usage(); if (!stopped.current) setUsage(next);}
    catch (error) {if (!stopped.current) setSnackbar(error instanceof Error ? error.message : 'Unable to read cache usage');}
    finally {cacheBusy.current = false; if (!stopped.current) setMaintenanceState('idle');}
  }
  async function clearCache() {
    if (!maintenance || cacheBusy.current || selectedBytes <= 0) return; cacheBusy.current = true; setMaintenanceState('clearing');
    try {
      const freed = await maintenance.clear(selected), next = await maintenance.usage();
      if (!stopped.current) {setUsage(next); setCleanup(false); setSnackbar(t('setting_clear_cache_done_desc', [formatCacheSize(freed)]));}
    } catch (error) {if (!stopped.current) setSnackbar(error instanceof Error ? error.message : 'Unable to clear cache');}
    finally {cacheBusy.current = false; if (!stopped.current) setMaintenanceState('idle');}
  }
  useEffect(() => {
    navigation.setOptions({title: 'Debug Info', headerTitleAlign: 'left', headerTitleStyle: {fontSize: 22, fontWeight: '400'}});
    stopped.current = false;
    try {setInfo(systemInfo());} catch { /* Preserve an empty source section if platform information is unavailable. */ }
    void runAll(); void refreshUsage();
    return () => {stopped.current = true; requestAbort.current?.abort();};
  }, [maintenance]);
  useEffect(() => {if (database) {setSync(database.currentStatus); return database.registerListener({statusChanged: setSync});}}, [database]);
  useEffect(() => {const available = nonEmptyCacheCategories(usage); setSelected(previous => changedSelection.current ? previous.filter(category => available.includes(category)) : available);}, [usage]);
  useEffect(() => {if (!snackbar) return; const timeout = setTimeout(() => setSnackbar(''), 4000); return () => clearTimeout(timeout);}, [snackbar]);
  useFocusEffect(useCallback(() => {
    let alive = true, sensor: ReturnType<typeof Accelerometer.addListener> | null = null;
    const detect = createShakeDetector(() => {void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setEnvironment(true);});
    const stop = () => {sensor?.remove(); sensor = null;};
    const start = async () => {if (!await Accelerometer.isAvailableAsync() || !alive || AppState.currentState !== 'active' || sensor) return; Accelerometer.setUpdateInterval(100); sensor = Accelerometer.addListener(detect);};
    void start().catch(() => undefined);
    const listener = AppState.addEventListener('change', value => {if (value === 'active') void start().catch(() => undefined); else stop();});
    return () => {alive = false; stop(); listener.remove();};
  }, []));
  function section(title: string, children: React.ReactNode) {return <View style={styles.card}><SourceText accessibilityRole="header" style={styles.heading}>{title}</SourceText>{children}</View>;}
  function row(key: string, value: string, error = false) {return <View key={key} style={styles.row}><SourceText style={styles.label}>{key}</SourceText><SourceText style={[styles.value, error && {color: '#E53935'}]}>{value}</SourceText></View>;}
  const currentEnvironment = settings.selected_env === 'PRODUCTION' || settings.selected_env === 'BETA' ? settings.selected_env : null;
  return <ScreenSurface><ScrollView contentContainerStyle={styles.content}>
    {section('System Info', <>{Object.entries(info).map(([key,value]) => row(key, value))}</>)}
    {section('PowerSync Status', sync ? <>{row('Connected', sync.connected ? '✓ Yes' : '✗ No')}{row('Connecting', sync.connecting ? 'Yes' : 'No')}{row('Downloading', sync.downloading ? 'Yes' : 'No')}{row('Uploading', sync.uploading ? 'Yes' : 'No')}{sync.downloadError || sync.uploadError ? row('Error', String(sync.downloadError ?? sync.uploadError), true) : null}{sync.downloading ? row('Progress', sync.downloadProgress ? `${sync.downloadProgress.downloadedOperations}/${sync.downloadProgress.totalOperations}` : 'Preparing...') : null}</> : row('Status', 'Not initialized'))}
    {section('Cache Maintenance', <><SourceText style={{fontSize: 14, lineHeight: 20, color: '#666666'}}>{t('setting_clear_cache_desc')}</SourceText><SourceButton testID="debug_cache_open" label={`${t('setting_clear_cache')} - ${formatCacheSize(total)}`} busy={busy} disabled={busy || !maintenance} onPress={() => {changedSelection.current = false; setSelected(nonEmptyCacheCategories(usage)); setCleanup(true); void refreshUsage();}} style={styles.debugButton} textStyle={styles.debugButtonText}/></>)}
    {section('Network Tests', <><SourceButton label={testing ? 'Testing...' : 'Run All Tests'} disabled={testing} onPress={() => {void runAll();}} style={styles.networkButton} textStyle={styles.debugButtonText}/><View style={{height: 12}}/>{results.map(result => <View key={result.name} style={styles.test}><View style={{width: 12, height: 12, borderRadius: 6, backgroundColor: resultColors[result.status]}}/><View style={{flex: 1}}><SourceText style={{fontSize: 14, fontWeight: '500'}}>{result.name}</SourceText>{result.message ? <SourceText style={{fontSize: 12, fontFamily: mono, color: '#666666'}}>{result.message}</SourceText> : null}</View>{result.status === 'testing' ? <ActivityIndicator size="small" color={C.text} style={{width: 16, height: 16}}/> : null}</View>)}</>)}
  </ScrollView>
    <SourceSheet visible={cleanup} busy={maintenanceState === 'clearing'} onDismiss={() => setCleanup(false)} bottomPadding={20} handleColor="#33333329" style={{paddingHorizontal: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: '#FFFFFF'}} contentContainerStyle={{gap: 0}}>
      <SourceText accessibilityRole="header" style={{fontSize: 20, lineHeight: 28, fontWeight: '600', textAlign: 'center'}}>{t('setting_cache_sheet_title')}</SourceText>
      <View style={{alignItems: 'center', marginTop: 20, marginBottom: 24}}><SourceRing key={String(cleanup)} size={156} thickness={12} revealDuration={420} segments={cacheCategories.map(category => ({fraction: total ? usage[category] / total : 0, color: categoryColors[category]}))}/><View pointerEvents="none" style={[StyleSheet.absoluteFill, {justifyContent: 'center', alignItems: 'center'}]}><SourceText style={{fontSize: 24, lineHeight: 30, fontWeight: '600'}}>{formatCacheSize(total)}</SourceText><SourceText style={{fontSize: 12, lineHeight: 17, color: C.mutedText, marginTop: 2}}>{t('setting_cache_used')}</SourceText></View></View>
      <Divider/>{cacheCategories.map(category => {
        const enabled = usage[category] > 0 && !busy, checked = selected.includes(category), key = categoryKeys[category];
        return <Pressable key={category} testID={`debug_cache_${category}`} accessibilityRole="checkbox" accessibilityLabel={t(`setting_cache_${key}`)} accessibilityState={{checked, disabled: !enabled}} disabled={!enabled} onPress={() => {changedSelection.current = true; setSelected(previous => checked ? previous.filter(value => value !== category) : [...previous, category]);}} style={styles.category}>
          <View style={{width: 12, height: 12, borderRadius: 6, backgroundColor: categoryColors[category]}}/><View style={{flex: 1}}><SourceText style={{fontSize: 15, lineHeight: 21, fontWeight: '500'}}>{t(`setting_cache_${key}`)}</SourceText><SourceText style={{fontSize: 13, lineHeight: 18, color: C.mutedText, marginTop: 2}}>{t(`setting_cache_${key}_desc`)}</SourceText></View><SourceText style={{fontSize: 14, lineHeight: 20, color: '#777777', marginLeft: -2}}>{formatCacheSize(usage[category])}</SourceText><View style={{width: 48, height: 48, marginLeft: -12, justifyContent: 'center', alignItems: 'center'}}><View style={{width: 18, height: 18, borderWidth: checked ? 0 : 2, borderRadius: 2, borderColor: '#B8B3AC', backgroundColor: checked ? '#B45837' : 'transparent', alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.38}}>{checked ? <SourceIcon name="ic_xs_tick_gray_outline_icon" size={12} style={{tintColor: '#FFFFFF'}}/> : null}</View></View>
        </Pressable>;
      })}<Divider/>
      <SourceText style={{fontSize: 13, lineHeight: 19, color: '#777777', marginTop: 14}}>{t('setting_cache_sheet_notice')}</SourceText>
      <SourceButton testID="debug_cache_clear" label={selectedBytes ? t('setting_cache_clear_amount', [formatCacheSize(selectedBytes)]) : t('setting_cache_nothing_to_clear')} tone="rss" busy={busy} disabled={busy || selectedBytes <= 0} onPress={() => {void clearCache();}} style={{height: 50, borderRadius: 8, marginTop: 20, backgroundColor: busy && maintenanceState === 'clearing' || !busy && selectedBytes > 0 ? '#B45837' : '#E8E6E3'}} textStyle={{fontSize: 16, lineHeight: 22, fontWeight: '500'}}/>
    </SourceSheet>
    <SourceDialog visible={environment} onDismiss={() => setEnvironment(false)} title="切换环境" actions={<TextAction label="取消" onPress={() => setEnvironment(false)}/>}>
      <SourceText style={{fontSize: 14, color: '#666666', marginBottom: 12}}>当前：{currentEnvironment === 'PRODUCTION' ? '生产' : currentEnvironment === 'BETA' ? 'beta' : '默认（编译期）'}</SourceText>
      {(['PRODUCTION','BETA'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{selected: currentEnvironment === value}} style={{paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, backgroundColor: currentEnvironment === value ? '#E8F5F1' : '#F0F0F0', marginBottom: value === 'PRODUCTION' ? 8 : 0, flexDirection: 'row', justifyContent: 'space-between'}} onPress={() => {setEnvironment(false); void preferences.update(next => {next.selected_env = value;}).then(() => {if (!stopped.current) setRestart(true);}).catch(error => {if (!stopped.current) setSnackbar(String(error));});}}><SourceText style={{fontSize: 16}}>{value === 'PRODUCTION' ? '生产' : 'beta'}</SourceText>{currentEnvironment === value ? <SourceText style={{fontSize: 16, color: C.accent}}>✓</SourceText> : null}</Pressable>)}
    </SourceDialog>
    <SourceDialog visible={restart} onDismiss={() => setRestart(false)} title="已切换环境" actions={<TextAction label="我知道了" onPress={() => setRestart(false)}/>}><SourceText>请完全关闭并重启 App 后生效。</SourceText></SourceDialog>
    {snackbar ? <View accessibilityLiveRegion="polite" style={styles.snackbar}><SourceText style={{fontSize: 14, color: '#F5EFF7'}}>{snackbar}</SourceText></View> : null}
  </ScreenSurface>;
}
const styles = StyleSheet.create({content: {paddingHorizontal: 16, paddingTop: 24, paddingBottom: 32, gap: 16}, card: {padding: 16, borderRadius: 12, backgroundColor: '#FFFFFF'}, heading: {fontSize: 18, fontWeight: '600', marginBottom: 12}, row: {flexDirection: 'row', paddingVertical: 4}, label: {fontSize: 14, color: '#666666', flex: 1}, value: {fontSize: 14, fontFamily: mono, flex: 1}, debugButton: {backgroundColor: C.text, marginTop: 12, minHeight: 40, borderRadius: 20, paddingVertical: 8}, debugButtonText: {fontSize: 14, lineHeight: 20, fontWeight: '500'}, networkButton: {backgroundColor: C.text, minHeight: 40, borderRadius: 20, paddingVertical: 8}, test: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8}, category: {flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12}, snackbar: {position: 'absolute', bottom: 8, left: 16, right: 16, minHeight: 48, borderRadius: 4, backgroundColor: '#322F35', paddingHorizontal: 16, paddingVertical: 14}});
