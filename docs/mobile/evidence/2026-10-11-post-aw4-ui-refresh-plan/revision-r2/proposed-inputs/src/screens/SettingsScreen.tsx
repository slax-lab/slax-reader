import React, { useLayoutEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenSurface, SourceButton, SourceDialog, SourceIcon, SourceSwitch, SourceText, Divider, TextAction } from '../components';
import {SourceParagraph} from '../components/SourceParagraph';
import type { MobileScreenProps } from '../navigation/types';
import { useMobile } from '../runtime';
import { mobileColors as C, mobileLayout as L, mobileTypography as T } from '../theme';
import { mobileTestIds as IDs } from '../theme/testIds';

export function SettingsScreen({navigation}: MobileScreenProps<'Settings'>) {
  const {t, locale, settings, preferences, api} = useMobile();
  const [language, setLanguage] = useState(false), [error, setError] = useState<string | null>(null);
  const [rss, setRss] = useState({enabled: false, ready: false, busy: false, failed: false});
  const request = React.useRef<AbortController | null>(null);
  const loadRss = React.useCallback(async (enabled?: boolean) => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setRss(value => ({...value, busy: true, failed: false}));
    try {
      const value = enabled === undefined ? (await api.rssLabs(controller.signal)).features.some(feature => feature.key === 'rss' && feature.enabled) : (await api.rssEnable(enabled, controller.signal), enabled);
      if (!controller.signal.aborted) setRss({enabled: value, ready: true, busy: false, failed: false});
    } catch { if (!controller.signal.aborted) setRss(value => ({...value, busy: false, failed: true})); }
    finally { if (request.current === controller) request.current = null; }
  }, [api]);
  useFocusEffect(React.useCallback(() => { void loadRss(); return () => { request.current?.abort(); request.current = null; }; }, [loadRss]));
  useLayoutEffect(() => navigation.setOptions({title: t('setting_title'), headerTitleAlign: 'center'}), [navigation, t]);
  const cacheCount = typeof settings.cache_count === 'number' ? settings.cache_count : 50;
  const images = (settings.download_images ?? 1) === 1;
  function save(key: string, value: string | number) { void preferences.update(next => { next[key] = value; }).catch(reason => setError(String(reason.message ?? reason))); }
  return <ScreenSurface testID={IDs.SettingScreen} bottomInset={false} sourceAppBar>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.row}><SourceText style={T.button}>{t('setting_offline_cache_title')}</SourceText><SourceText style={styles.muted}>{cacheCount === -1 ? '∞' : cacheCount}</SourceText></View>
        <View style={styles.steps}>{[30, 50, 100, 200, -1].map(step => <Pressable key={step} accessibilityRole="button" accessibilityState={{selected: cacheCount === step}} accessibilityLabel={String(step === -1 ? '∞' : step)} onPress={() => save('cache_count', step)} style={[styles.step, {backgroundColor: cacheCount === step ? C.bodyText : C.background}]}><SourceText style={{fontSize: 15, lineHeight: 21, fontWeight: '500', color: cacheCount === step ? C.surface : C.bodyText}}>{step === -1 ? '∞' : step}</SourceText></Pressable>)}</View>
        <SourceParagraph text={t('setting_offline_cache_desc')} fontSize={14} lineHeight={20} color={C.secondaryText} style={{marginTop: 16}} />
        <View style={{marginTop: 20, marginBottom: 16}}><Divider /></View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked: images}} onPress={() => save('download_images', images ? 0 : 1)}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}><View style={styles.checkbox}>{images ? <SourceIcon name="ic_xs_tick_gray_outline_icon" size={8} /> : null}</View><SourceText style={T.metadata}>{t('setting_download_images')}</SourceText></View>
          <SourceParagraph text={t('setting_download_images_desc')} fontSize={14} lineHeight={20} color={C.secondaryText} style={{marginTop: 12}} />
        </Pressable>
      </View>
      <Pressable testID={IDs.SettingLanguage} accessibilityRole="button" onPress={() => setLanguage(true)} style={[styles.card, styles.row]}><SourceText style={T.button}>{t('setting_language')}</SourceText><SourceText style={styles.muted}>{t(locale === 'zh' ? 'language_chinese' : 'language_english')}</SourceText></Pressable>
      <View style={[styles.card, {paddingVertical: 8}]}>
        <View style={[styles.row, {minHeight: 48}]}><SourceText style={T.button}>{t('rss_title')}</SourceText><SourceSwitch label={t('rss_title')} value={rss.enabled} onChange={value => void loadRss(value)} disabled={!rss.ready || rss.busy} /></View>
        {rss.failed ? <><SourceText style={[T.metadata, {color: C.danger}]}>{t('rss_error_source_unavailable')}</SourceText><TextAction label={t('rss_retry')} onPress={() => void loadRss()} /></> : null}
      </View>
      <SourceButton testID={IDs.SettingDeleteAccount} label={t('setting_delete_account')} tone="surface" destructive onPress={() => navigation.navigate('DeleteAccount')} style={{minHeight: 55}} />
    </ScrollView>
    <SourceDialog visible={language} onDismiss={() => setLanguage(false)} title={t('setting_language')}>
      {(['zh', 'en'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: locale === value}} onPress={() => { save('user_language', value); setLanguage(false); }} style={styles.language}><View style={[styles.radio, {borderColor: locale === value ? C.accent : C.mutedText}]}>{locale === value ? <View style={styles.radioDot} /> : null}</View><SourceText>{t(value === 'zh' ? 'language_chinese' : 'language_english')}</SourceText></Pressable>)}
    </SourceDialog>
    <SourceDialog visible={error !== null} onDismiss={() => setError(null)} title={t('feedback_error_title')} actions={<TextAction label={t('btn_ok')} onPress={() => setError(null)} />}><SourceText>{error}</SourceText></SourceDialog>
  </ScreenSurface>;
}
const styles = StyleSheet.create({
  content: {paddingHorizontal: L.settingsInset, paddingTop: 8, paddingBottom: 30, gap: 12}, card: {backgroundColor: C.surface, borderRadius: L.settingsCardRadius, padding: 16}, row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12}, muted: {...T.metadata, color: C.mutedText},
  steps: {flexDirection: 'row', flexWrap: 'wrap', gap: L.cacheChoiceGap, marginTop: 20}, step: {width: L.cacheChoiceWidth, minHeight: L.cacheChoiceHeight, borderRadius: L.cacheChoiceRadius, alignItems: 'center', justifyContent: 'center'}, checkbox: {width: 12, height: 12, borderRadius: 2, borderWidth: 0.5, borderColor: '#1A1A1A29', alignItems: 'center', justifyContent: 'center'},
  language: {flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 16}, radio: {width: 20, height: 20, borderWidth: 2, borderRadius: 10, justifyContent: 'center', alignItems: 'center', margin: 12}, radioDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent},
});
