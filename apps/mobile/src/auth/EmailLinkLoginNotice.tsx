import React from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {SourceSheetModal} from '../components/SourceSheetModal';
import {mobileColors as C} from '../theme';
import type {createTranslator} from '../i18n';
import type {useEmailLinkLogin} from './useEmailLinkLogin';

type Props = ReturnType<typeof useEmailLinkLogin> & {t: ReturnType<typeof createTranslator>};
export function EmailLinkLoginNotice({state, dismiss, continueOnWeb, t}: Props) {
  const visible = state.status !== 'idle' && state.status !== 'agreement';
  const message = state.status === 'active' ? 'email_login_link_active' : state.status === 'environment' ? 'email_login_link_environment' : 'email_login_link_failed';
  return <SourceSheetModal visible={visible} onDismiss={dismiss}>
    <View style={styles.body}>
      {state.status === 'loading' ? <ActivityIndicator accessibilityLabel={t('email_login_link_loading')}/> : <Text style={styles.message}>{t(message)}</Text>}
      {state.status === 'environment' && <Pressable accessibilityRole="button" onPress={() => {void continueOnWeb();}} style={styles.button}><Text style={styles.action}>{t('email_login_link_browser')}</Text></Pressable>}
      <Pressable accessibilityRole="button" onPress={dismiss} style={styles.button}><Text style={styles.action}>{t('btn_close')}</Text></Pressable>
    </View>
  </SourceSheetModal>;
}
const styles = StyleSheet.create({body: {padding: 24, gap: 16}, message: {fontSize: 15, lineHeight: 22, color: C.text}, button: {minHeight: 44, alignItems: 'center', justifyContent: 'center'}, action: {fontSize: 15, color: C.link}});
