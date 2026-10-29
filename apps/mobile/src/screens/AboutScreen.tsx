import React, { useLayoutEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ScreenSurface, SourceIcon, SourceText, TextAction } from '../components';
import type { MobileScreenProps } from '../navigation/types';
import { useMobile } from '../runtime';
import {useDiagnosticShare} from '../diagnostics/useDiagnosticShare';
import { mobileColors as C, mobileTypography as T } from '../theme';

export function AboutScreen({navigation}: MobileScreenProps<'About'>) {
  const {t, config} = useMobile(), diagnostics = useDiagnosticShare();
  const taps = useRef(0);
  useLayoutEffect(() => navigation.setOptions({title: ''}), [navigation]);
  return <ScreenSurface sourceAppBar><ScrollView contentContainerStyle={styles.content}>
    <View style={{marginTop: 44}}><SourceIcon name="ic_app_logo" size={64} /></View>
    <SourceText style={[T.loginTitle, {marginTop: 20}]}>Slax Reader</SourceText>
    <Pressable accessibilityRole="button" onPress={() => { if (++taps.current >= 5) { taps.current = 0; navigation.navigate('Debug'); } }} style={{marginTop: 12}}>
      <SourceText style={[T.loginSubtitle, {color: C.mutedText}]}>{t('about_version')} {config.version} ({config.buildNumber})</SourceText>
    </Pressable>
    <View style={styles.diagnostics}>
      <SourceText style={T.loginSubtitle}>{t('diagnostic_logs')}</SourceText>
      <TextAction testID="about-diagnostic-view" label={t('diagnostic_open')} disabled={diagnostics.busy} onPress={() => navigation.navigate('DiagnosticLog')}/>
      <TextAction testID="about-diagnostic-share" label={t(diagnostics.busy ? 'diagnostic_preparing_share' : 'diagnostic_share_recent')} disabled={diagnostics.busy} onPress={() => void diagnostics.share()}/>
      {diagnostics.error ? <SourceText accessibilityRole="alert" style={styles.error}>{diagnostics.error}</SourceText> : null}
    </View>
  </ScrollView></ScreenSurface>;
}
const styles = StyleSheet.create({content: {alignItems: 'center', paddingHorizontal: 24, paddingBottom: 32}, diagnostics: {alignSelf: 'stretch', marginTop: 32, gap: 12, alignItems: 'center'}, error: {color: C.secondaryText, textAlign: 'center'}});
