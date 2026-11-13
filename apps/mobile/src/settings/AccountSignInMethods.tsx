import React from 'react';
import {StyleSheet, View} from 'react-native';
import {EmailCodeDialog} from '../auth/EmailCodeDialog';
import {SourceButton, SourceText} from '../components/SourceUI';
import type {SlaxApi, NativeProvider} from '../data/api';
import type {createTranslator, MobileLocale} from '../i18n';
import {mobileColors as C, mobileLayout as L, mobileTypography as T} from '../theme';
import type {usePasskeys} from './usePasskeys';
import type {useLinkedPlatforms} from './useLinkedPlatforms';

interface AccountSignInMethodsProps {
  t: ReturnType<typeof createTranslator>;
  locale: MobileLocale;
  platform: NativeProvider['platform'];
  state: ReturnType<typeof useLinkedPlatforms>;
  passkeys: ReturnType<typeof usePasskeys>;
  api: Pick<SlaxApi, 'sendBindingEmail' | 'verifyBindingEmail'>;
}

export function AccountSignInMethods({t, locale, platform, state, passkeys, api}: AccountSignInMethodsProps) {
  const {platforms, busy, error, emailFlow} = state;
  if (!platforms) return null;
  const linked = new Map(platforms.map(item => [item.platform, item]));
  const email = linked.get('mail');
  return <View style={styles.card}>
    <SourceText accessibilityRole="header" style={T.button}>{t('email_auth_methods')}</SourceText>
    {linked.has('google') ? <SourceText style={styles.secondary}>{t('email_auth_google_linked')}</SourceText>
      : <SourceButton label={t('email_auth_link_google')} tone="surface" style={styles.button}
        busy={busy === 'google'} disabled={busy === 'apple' || Boolean(passkeys.busy)} onPress={() => {void state.linkProvider('google');}} />}
    {linked.has('apple') ? <SourceText style={styles.secondary}>{t('email_auth_apple_linked')}</SourceText>
      : platform === 'android' ? <SourceText style={styles.secondary}>{t('email_auth_link_apple_hint')}</SourceText>
      : <SourceButton label={t('email_auth_link_apple')} tone="surface" style={styles.button}
        busy={busy === 'apple'} disabled={busy === 'google' || Boolean(passkeys.busy)} onPress={() => {void state.linkProvider('apple');}} />}
    {email ? <View>
      <SourceText style={styles.secondary}>{t('email_auth_address')}</SourceText>
      <SourceText selectable>{email.user_name}</SourceText>
    </View> : <SourceButton label={t('email_auth_bind')} tone="surface" style={[styles.button, styles.emailButton]} textStyle={styles.emailButtonText}
      disabled={Boolean(busy || passkeys.busy)} onPress={state.openEmail} />}
    {passkeys.enabled && <>
      <SourceText accessibilityRole="header" style={T.button}>{t('passkey_title')}</SourceText>
      {!email && <SourceText style={styles.secondary}>{t('passkey_mail_required')}</SourceText>}
      {passkeys.passkeys?.map(item => <View key={item.uuid} style={styles.passkey}>
        <View style={styles.passkeyName}><SourceText>{item.name}</SourceText>
          <SourceText style={styles.secondary}>{t('passkey_created', {date: new Date(item.created_at).toLocaleDateString(locale)})}</SourceText>
        </View>
        <SourceButton label={t('passkey_delete')} tone="surface" destructive disabled={Boolean(busy || passkeys.busy)}
          busy={passkeys.busy === item.uuid} onPress={() => passkeys.remove(item.uuid)} />
      </View>)}
      <SourceButton label={t('passkey_create')} tone="surface" style={styles.button} busy={passkeys.busy === 'create'}
        disabled={!email || Boolean(busy || passkeys.busy || emailFlow)} onPress={passkeys.create} />
      {passkeys.error && <View>
        <SourceText accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{t(passkeys.error)}</SourceText>
        {passkeys.error === 'passkey_load_failed' && <SourceButton label={t('btn_retry')} tone="surface" onPress={passkeys.reload} />}
      </View>}
    </>}
    {error && <SourceText accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{t(error)}</SourceText>}
    {!email && emailFlow && <EmailCodeDialog mode="binding" t={t} locale={locale}
      send={api.sendBindingEmail} verify={api.verifyBindingEmail} isCurrent={emailFlow.current}
      onVerified={state.emailLinked} onClose={state.closeEmail} />}
  </View>;
}

const styles = StyleSheet.create({
  card: {backgroundColor: C.surface, borderRadius: L.settingsCardRadius, padding: 16, gap: 10},
  button: {borderWidth: 1, borderColor: C.buttonBorder},
  emailButton: {borderWidth: 0},
  emailButtonText: {...T.metadata, color: C.secondaryText},
  passkey: {flexDirection: 'row', alignItems: 'center', gap: 12},
  passkeyName: {flex: 1},
  secondary: {...T.metadata, color: C.secondaryText},
  error: {...T.metadata, color: C.validationError},
});
