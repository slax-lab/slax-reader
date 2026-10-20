import React from 'react';
import {Platform, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {
  Divider, ScreenSurface, SourceButton, SourceDialog, SourceIcon,
  SourceSwitch, SourceText, TextAction,
} from '../components';
import {SourceParagraph} from '../components/SourceParagraph';
import type {createTranslator, MobileLocale} from '../i18n';
import {mobileColors as C, mobileLayout as L, mobileTypography as T} from '../theme';
import {mobileTestIds as IDs} from '../theme/testIds';
import type {SettingsState} from './useSettingsState';
import type {LabState} from './useRssLab';

export interface SettingsViewProps {
  t: ReturnType<typeof createTranslator>;
  locale: MobileLocale;
  state: SettingsState;
  rss: LabState;
  pdf: LabState;
  showAdaptivePdfPrototype?: boolean;
  onDeleteAccount(): void;
  systemSurfaceFailed?: boolean;
  systemSurfaceAvailable?: boolean;
  systemDiscoveryAvailable?: boolean;
  onRetrySystemSurfaces?(): void;
}

export function SettingsView({t, locale, state, rss, pdf, showAdaptivePdfPrototype = false, onDeleteAccount, systemSurfaceFailed, systemSurfaceAvailable = false, systemDiscoveryAvailable = false, onRetrySystemSurfaces}: SettingsViewProps) {
  return (
    <ScreenSurface testID={IDs.SettingScreen} bottomInset={false} sourceAppBar>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.row}>
            <SourceText style={T.button}>{t('setting_offline_cache_title')}</SourceText>
            <SourceText style={styles.muted}>{state.cacheCount === -1 ? '∞' : state.cacheCount}</SourceText>
          </View>
          <View style={styles.steps}>
            {[30, 50, 100, 200, -1].map(step => {
              const selected = state.cacheCount === step;
              const label = step === -1 ? '∞' : String(step);
              return (
                <Pressable
                  key={step}
                  accessibilityRole="button"
                  accessibilityState={{selected}}
                  accessibilityLabel={label}
                  onPress={() => state.setCacheCount(step)}
                  style={[styles.step, {backgroundColor: selected ? C.bodyText : C.background}]}
                >
                  <SourceText style={[styles.stepText, {color: selected ? C.surface : C.bodyText}]}>{label}</SourceText>
                </Pressable>
              );
            })}
          </View>
          <SourceParagraph text={t('setting_offline_cache_desc')} fontSize={14} lineHeight={20} color={C.secondaryText} style={{marginTop: 16}} />
          <View style={{marginTop: 20, marginBottom: 16}}><Divider /></View>
          <Pressable accessibilityRole="checkbox" accessibilityState={{checked: state.images}} onPress={state.toggleImages}>
            <View style={styles.imageChoice}>
              <View style={styles.checkbox}>
                {state.images ? <SourceIcon name="ic_xs_tick_gray_outline_icon" size={8} /> : null}
              </View>
              <SourceText style={T.metadata}>{t('setting_download_images')}</SourceText>
            </View>
            <SourceParagraph text={t('setting_download_images_desc')} fontSize={14} lineHeight={20} color={C.secondaryText} style={{marginTop: 12}} />
          </Pressable>
        </View>
        <Pressable testID={IDs.SettingLanguage} accessibilityRole="button" onPress={state.showLanguage} style={[styles.card, styles.row]}>
          <SourceText style={T.button}>{t('setting_language')}</SourceText>
          <SourceText style={styles.muted}>{t(locale === 'zh' ? 'language_chinese' : 'language_english')}</SourceText>
        </Pressable>
        <View style={[styles.card, styles.labCard]}>
          <View style={[styles.row, styles.labRow]}>
            <SourceText style={T.button}>{t('rss_title')}</SourceText>
            <SourceSwitch label={t('rss_title')} value={rss.enabled} onChange={value => void rss.load(value)} disabled={!rss.ready || rss.busy} />
          </View>
          {rss.failed ? <>
            <SourceText style={[T.metadata, {color: C.danger}]}>{t('rss_error_source_unavailable')}</SourceText>
            <TextAction label={t('rss_retry')} onPress={() => void rss.load()} />
          </> : null}
        </View>
        <View style={[styles.card, styles.labCard]}>
          <View style={[styles.row, styles.labRow]}>
            <SourceText style={T.button}>{t('pdf_title')}</SourceText>
            <SourceSwitch label={t('pdf_title')} value={pdf.enabled} onChange={value => void pdf.load(value)} disabled={!pdf.ready || pdf.busy} />
          </View>
          <SourceText style={[T.metadata, {color: C.secondaryText, marginBottom: 8}]}>{t('pdf_enable_hint')}</SourceText>
          {showAdaptivePdfPrototype ? <View style={styles.row}>
            <SourceText style={T.button}>Dual-page prototype</SourceText>
            <SourceSwitch label="Dual-page prototype" value={state.adaptivePdfPrototype} onChange={state.setAdaptivePdfPrototype} />
          </View> : null}
          {pdf.failed ? <>
            <SourceText style={[T.metadata, {color: C.danger}]}>{t('pdf_labs_error')}</SourceText>
            <TextAction label={t('rss_retry')} onPress={() => void pdf.load()} />
          </> : null}
        </View>
        {Platform.OS === 'ios' && systemSurfaceAvailable ? <View style={[styles.card, styles.labCard]}>
          <View style={[styles.row, styles.labRow]}>
            <SourceText style={T.button}>{t('system_discovery_title')}</SourceText>
            {systemDiscoveryAvailable ? <SourceSwitch label={t('system_discovery_title')} value={state.systemDiscovery} onChange={state.setSystemDiscovery} /> : <SourceText style={T.metadata}>{t('system_discovery_unavailable')}</SourceText>}
          </View>
          <SourceText style={[T.metadata, {color: C.secondaryText, marginBottom: 8}]}>{t('system_discovery_description')}</SourceText>
          <View style={[styles.row, styles.labRow]}>
            <SourceText style={T.button}>{t('system_donations_title')}</SourceText>
            <SourceSwitch label={t('system_donations_title')} value={state.systemDonations} onChange={state.setSystemDonations} />
          </View>
          <SourceText style={[T.metadata, {color: C.secondaryText}]}>{t('system_donations_description')}</SourceText>
          {systemSurfaceFailed ? <View style={{marginTop: 8}}><SourceText style={[T.metadata, {color: C.danger}]}>{t('system_surface_error')}</SourceText><TextAction label={t('rss_retry')} onPress={onRetrySystemSurfaces ?? (() => {})}/></View> : null}
        </View> : null}
        <SourceButton testID={IDs.SettingDeleteAccount} label={t('setting_delete_account')} tone="surface" destructive onPress={onDeleteAccount} style={{minHeight: 55}} />
      </ScrollView>
      <SourceDialog visible={state.language} onDismiss={state.dismissLanguage} title={t('setting_language')}>
        {(['zh', 'en'] as const).map(value => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{checked: locale === value}}
            onPress={() => state.selectLanguage(value)}
            style={styles.language}
          >
            <View style={[styles.radio, {borderColor: locale === value ? C.accent : C.mutedText}]}>
              {locale === value ? <View style={styles.radioDot} /> : null}
            </View>
            <SourceText>{t(value === 'zh' ? 'language_chinese' : 'language_english')}</SourceText>
          </Pressable>
        ))}
      </SourceDialog>
      <SourceDialog
        visible={state.error !== null}
        onDismiss={state.dismissError}
        title={t('feedback_error_title')}
        actions={<TextAction label={t('btn_ok')} onPress={state.dismissError} />}
      >
        <SourceText>{state.error}</SourceText>
      </SourceDialog>
    </ScreenSurface>
  );
}

const styles = StyleSheet.create({
  content: {paddingHorizontal: L.settingsInset, paddingTop: 8, paddingBottom: 30, gap: 12},
  card: {backgroundColor: C.surface, borderRadius: L.settingsCardRadius, padding: 16},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  muted: {...T.metadata, color: C.mutedText},
  steps: {flexDirection: 'row', flexWrap: 'wrap', gap: L.cacheChoiceGap, marginTop: 20},
  step: {
    width: L.cacheChoiceWidth, minHeight: L.cacheChoiceHeight, borderRadius: L.cacheChoiceRadius,
    alignItems: 'center', justifyContent: 'center',
  },
  stepText: {fontSize: 15, lineHeight: 21, fontWeight: '500'},
  imageChoice: {flexDirection: 'row', alignItems: 'center', gap: 8},
  checkbox: {
    width: 12, height: 12, borderRadius: 2, borderWidth: 0.5, borderColor: '#1A1A1A29',
    alignItems: 'center', justifyContent: 'center',
  },
  labCard: {paddingVertical: 8},
  labRow: {minHeight: 48},
  language: {flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 16},
  radio: {
    width: 20, height: 20, borderWidth: 2, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center', margin: 12,
  },
  radioDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent},
});
