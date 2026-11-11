import React from 'react';
import {StyleSheet, View} from 'react-native';
import {EmailCodeDialog} from '../auth/EmailCodeDialog';
import {SourceButton, SourceText} from '../components/SourceUI';
import type {SlaxApi, NativeProvider} from '../data/api';
import type {createTranslator, MobileLocale} from '../i18n';
import {mobileColors as C, mobileLayout as L, mobileTypography as T} from '../theme';
import type {useLinkedPlatforms} from './useLinkedPlatforms';

interface AccountSignInMethodsProps {
  t: ReturnType<typeof createTranslator>;
  locale: MobileLocale;
  platform: NativeProvider['platform'];
  state: ReturnType<typeof useLinkedPlatforms>;
  api: Pick<SlaxApi, 'sendBindingEmail' | 'verifyBindingEmail'>;
}

export function AccountSignInMethods({t, locale, platform, state, api}: AccountSignInMethodsProps) {
  const {platforms, development, busy, error, emailFlow} = state;
  if (!platforms) return null;
  const linked = new Map(platforms.map(item => [item.platform, item]));
  const email = linked.get('mail');
  return <View style={styles.card}>
    <SourceText accessibilityRole="header" style={T.button}>{t('email_auth_methods')}</SourceText>
    {email ? <View>
      <SourceText style={styles.secondary}>{t('email_auth_address')}</SourceText>
      <SourceText selectable>{email.user_name}</SourceText>
    </View> : development && <SourceButton label={t('email_auth_bind')} tone="surface" style={styles.button}
      disabled={Boolean(busy)} onPress={state.openEmail} />}
    {linked.has('google') ? <SourceText style={styles.secondary}>{t('email_auth_google_linked')}</SourceText>
      : <SourceButton label={t('email_auth_link_google')} tone="surface" style={styles.button}
        busy={busy === 'google'} disabled={busy === 'apple'} onPress={() => {void state.linkProvider('google');}} />}
    {linked.has('apple') ? <SourceText style={styles.secondary}>{t('email_auth_apple_linked')}</SourceText>
      : platform === 'android' ? <SourceText style={styles.secondary}>{t('email_auth_link_apple_hint')}</SourceText>
      : <SourceButton label={t('email_auth_link_apple')} tone="surface" style={styles.button}
        busy={busy === 'apple'} disabled={busy === 'google'} onPress={() => {void state.linkProvider('apple');}} />}
    {error && <SourceText accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{t(error)}</SourceText>}
    {development && !email && emailFlow && <EmailCodeDialog mode="binding" t={t} locale={locale}
      send={api.sendBindingEmail} verify={api.verifyBindingEmail} isCurrent={emailFlow.current}
      onVerified={state.emailLinked} onClose={state.closeEmail} />}
  </View>;
}

const styles = StyleSheet.create({
  card: {backgroundColor: C.surface, borderRadius: L.settingsCardRadius, padding: 16, gap: 10},
  button: {borderWidth: 1, borderColor: C.buttonBorder},
  secondary: {...T.metadata, color: C.secondaryText},
  error: {...T.metadata, color: C.validationError},
});
