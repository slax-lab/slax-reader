import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {ScreenSurface, SourceButton, SourceDialog, SourceText, TextAction} from '../components';
import {useDiagnosticLog} from '../diagnostics/useDiagnosticLog';
import {diagnosticSources} from '../domain/diagnostics';
import {mobileColors as C} from '../theme';
import type {MobileScreenProps} from '../navigation/types';

export function DiagnosticLogScreen({navigation}: MobileScreenProps<'DiagnosticLog'>) {
  const {controller, state, t} = useDiagnosticLog(), [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {navigation.setOptions({title: t('diagnostic_logs'), headerTitleAlign: 'left', headerTitleStyle: {fontSize: 22, fontWeight: '400'}});}, [navigation, t]);
  const records = state.records.filter(record => state.source === 'all' || record.src === state.source);
  return <ScreenSurface><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.card}><SourceText accessibilityRole="header" style={styles.heading}>{t('diagnostic_snapshot')}</SourceText>
      <SourceText selectable style={styles.json}>{state.snapshot ? JSON.stringify(state.snapshot, null, 2) : t('diagnostic_loading')}</SourceText>
      {!state.shareAvailable && <SourceText testID="diagnostic_share_unavailable" style={styles.notice}>{t('diagnostic_share_unavailable')}</SourceText>}
    </View>
    {state.error && <SourceText accessibilityRole="alert" style={styles.notice}>{t('diagnostic_error')}</SourceText>}
    <View style={styles.actions}><SourceButton testID="diagnostic_export" label={t('diagnostic_export')} disabled={state.busy} onPress={() => {void controller.exportSelected();}} style={styles.button}/><SourceButton testID="diagnostic_clear" label={t('diagnostic_clear')} disabled={state.busy} onPress={() => setConfirmClear(true)} style={styles.button}/></View>
    {state.busy && <ActivityIndicator color={C.text}/>}
    {state.day && <TextAction label={t('diagnostic_back')} onPress={() => controller.back()}/>}
    {state.detail ? <View style={styles.card}><SourceText accessibilityRole="header" style={styles.heading}>{state.detail.event}</SourceText><SourceText testID="diagnostic_detail" selectable style={styles.json}>{JSON.stringify(state.detail, null, 2)}</SourceText></View> : state.day ? <View style={styles.card}>
      <SourceText accessibilityRole="header" style={styles.heading}>{state.day}</SourceText>
      <View style={styles.filters}>{(['all', ...diagnosticSources] as const).map(source => <Pressable key={source} accessibilityRole="button" accessibilityState={{selected: state.source === source}} onPress={() => controller.filter(source)} style={[styles.filter, state.source === source && styles.selected]}><SourceText>{source === 'all' ? t('diagnostic_all') : source}</SourceText></Pressable>)}</View>
      {!records.length && <SourceText testID="diagnostic_empty_records" style={styles.notice}>{t('diagnostic_empty_records')}</SourceText>}
      {records.map((record, index) => <Pressable key={`${record.ts}-${record.src}-${index}`} accessibilityRole="button" onPress={() => controller.selectRecord(record)} style={styles.row}><SourceText>{record.event}</SourceText><SourceText style={styles.meta}>{record.ts} · {record.src}</SourceText></Pressable>)}
    </View> : <View style={styles.card}>
      <SourceText accessibilityRole="header" style={styles.heading}>{t('diagnostic_days')}</SourceText><SourceText style={styles.notice}>{t('diagnostic_export_hint')}</SourceText>
      {!state.days.length && !state.busy && <SourceText testID="diagnostic_empty" style={styles.notice}>{t('diagnostic_empty')}</SourceText>}
      {state.days.map(day => <View key={day.day} style={styles.day}><Pressable testID={`diagnostic_select_${day.day}`} accessibilityRole="checkbox" accessibilityLabel={`${t('diagnostic_select_day')} ${day.day}`} accessibilityState={{checked: state.selectedDays.includes(day.day)}} onPress={() => controller.toggleDay(day.day)} style={styles.checkbox}><SourceText>{state.selectedDays.includes(day.day) ? '✓' : '○'}</SourceText></Pressable><Pressable accessibilityRole="button" disabled={state.busy} onPress={() => {void controller.openDay(day.day);}} style={[styles.row, {flex: 1}]}><SourceText>{day.day}</SourceText><SourceText style={styles.meta}>{(day.size / 1024).toFixed(1)} KB · {day.files.map(file => file.src).join(', ')}</SourceText></Pressable></View>)}
    </View>}
  </ScrollView><SourceDialog visible={confirmClear} onDismiss={() => setConfirmClear(false)} title={t('diagnostic_clear')} actions={<><TextAction label={t('btn_cancel')} onPress={() => setConfirmClear(false)}/><TextAction label={t('diagnostic_clear')} onPress={() => {setConfirmClear(false); void controller.clear();}}/></>}><SourceText>{t('diagnostic_clear_confirm')}</SourceText></SourceDialog></ScreenSurface>;
}
const styles = StyleSheet.create({content: {paddingHorizontal: 16, paddingTop: 24, paddingBottom: 32, gap: 16}, card: {padding: 16, borderRadius: 12, backgroundColor: '#FFFFFF'}, heading: {fontSize: 18, fontWeight: '600', marginBottom: 12}, json: {fontSize: 12, lineHeight: 18, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'}, notice: {fontSize: 14, lineHeight: 20, color: '#666666', marginVertical: 8}, actions: {flexDirection: 'row', gap: 12}, button: {flex: 1, backgroundColor: C.text, minHeight: 40, borderRadius: 20, paddingVertical: 8}, filters: {flexDirection: 'row', flexWrap: 'wrap', gap: 8}, filter: {paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, backgroundColor: '#F0F0F0'}, selected: {backgroundColor: '#E8F5F1'}, row: {paddingVertical: 12, gap: 4}, meta: {fontSize: 12, color: '#666666'}, day: {flexDirection: 'row', alignItems: 'center'}, checkbox: {width: 48, height: 48, alignItems: 'center', justifyContent: 'center'}});
