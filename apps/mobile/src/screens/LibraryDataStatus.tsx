import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {SourceText} from '../components';
import type {MobileContextValue} from '../runtime';
import {mobileColors as C} from '../theme';

export function LibraryDataStatus({upgrade, t, retryStart}: Pick<MobileContextValue, 'upgrade' | 't' | 'retryStart'>) {
  if (upgrade.status !== 'verification-required' && upgrade.status !== 'error') {
    return <View testID="library-local-data-loading" accessibilityState={{busy: true}} />;
  }
  return <View testID="library-local-data-recovery" style={styles.recovery}>
    <SourceText style={styles.title}>{t(upgrade.status === 'verification-required' ? 'upgrade_required_title' : 'data_open_failed_title')}</SourceText>
    <SourceText style={styles.message}>{upgrade.status === 'verification-required' ? t('upgrade_required_message') : upgrade.error.message}</SourceText>
    <Pressable style={styles.retry} onPress={() => {void retryStart().catch(() => undefined);}} accessibilityRole="button"><SourceText style={{color: C.surface}}>{t('rss_retry')}</SourceText></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  recovery: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  title: {fontSize: 18, color: C.text, textAlign: 'center'},
  message: {fontSize: 14, lineHeight: 21, color: C.secondaryText, textAlign: 'center', marginTop: 16},
  retry: {backgroundColor: C.accent, marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24},
});
