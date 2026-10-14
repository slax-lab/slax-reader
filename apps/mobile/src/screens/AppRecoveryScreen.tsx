import React, {useLayoutEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {SourceText} from '../components';
import type {MobileContextValue} from '../runtime';
import {mobileColors as C} from '../theme';

export function AppRecoveryScreen({t, retryStart}: Pick<MobileContextValue, 't' | 'retryStart'>) {
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  async function retry() {
    if (active.current) return;
    active.current = true; setBusy(true);
    try {await retryStart();}
    catch { /* Runtime retains the failure and all recoverable local state. */ }
    finally {active.current = false; if (mounted.current) setBusy(false);}
  }
  return <SafeAreaView style={styles.root} testID="app-startup-recovery">
    <View accessibilityLiveRegion="polite">
      <SourceText style={styles.title}>{t('startup_failed_title')}</SourceText>
      <SourceText style={styles.message}>{t('startup_failed_message')}</SourceText>
    </View>
    <Pressable accessibilityRole="button" accessibilityState={{disabled: busy, busy}} disabled={busy} onPress={() => {void retry();}} style={[styles.retry, busy && {opacity: 0.5}]}>
      <SourceText style={{color: C.surface}}>{t('rss_retry')}</SourceText>
    </Pressable>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.background},
  title: {fontSize: 18, color: C.text, textAlign: 'center'},
  message: {fontSize: 14, lineHeight: 21, color: C.secondaryText, textAlign: 'center', marginTop: 16},
  retry: {backgroundColor: C.accent, marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24},
});
