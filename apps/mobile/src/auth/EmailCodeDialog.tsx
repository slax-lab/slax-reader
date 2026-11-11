import React from 'react';
import {ScrollView, StyleSheet, TextInput, View} from 'react-native';
import {SourceButton, SourceDialog, SourceText, TextAction} from '../components/SourceUI';
import type {createTranslator} from '../i18n';
import {mobileColors as C, mobileTypography as T} from '../theme';
import {useEmailCode, type EmailCodeOptions} from './useEmailCode';

interface EmailCodeDialogProps<T> extends EmailCodeOptions<T> {
  t: ReturnType<typeof createTranslator>;
  mode: 'login' | 'binding';
  dismissible?: boolean;
  onClose(): void | false;
}

export function EmailCodeDialog<T>({t, mode, dismissible = true, onClose, ...options}: EmailCodeDialogProps<T>) {
  const form = useEmailCode(options);
  const close = () => {if (onClose() !== false) form.cancel();};
  const title = t(mode === 'login' ? 'login_email' : 'email_auth_bind');
  const codeLabel = t('email_auth_code');
  const emailLabel = t('email_auth_address');
  const submitLabel = t(mode === 'login' ? 'email_auth_verify_login' : 'email_auth_verify_link');
  return <SourceDialog visible title={title} dismissible={dismissible} onDismiss={close}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
      {form.sentTo === undefined ? <>
        {mode === 'login' && <SourceText style={styles.hint}>{t('email_auth_intro')}</SourceText>}
        <SourceText style={T.metadata}>{emailLabel}</SourceText>
        <TextInput key="address" testID="email_code_address" accessibilityLabel={emailLabel} style={styles.input}
          selectionColor={C.accent} autoCapitalize="none" autoCorrect={false} autoComplete="email"
          keyboardType="email-address" returnKeyType="go" editable={!form.busy} maxLength={254}
          value={form.email} onChangeText={form.changeAddress} onSubmitEditing={form.sendCode} />
        <SourceButton testID="email_code_send" label={t('email_auth_send')} onPress={form.sendCode}
          busy={form.busy === 'send'} disabled={!form.canSend && form.busy !== 'send'} />
      </> : <>
        <SourceText style={styles.hint}>{t('email_auth_sent', {email: form.sentTo})}</SourceText>
        <SourceText style={T.metadata}>{codeLabel}</SourceText>
        <TextInput key="code" testID="email_code_value" accessibilityLabel={codeLabel} style={styles.input}
          selectionColor={C.accent} keyboardType="number-pad" autoComplete="one-time-code" autoFocus
          editable={form.canEditCode} value={form.code} onChangeText={form.changeCode} />
        <SourceButton testID="email_code_verify" label={submitLabel} onPress={form.verifyCode}
          busy={form.busy === 'verify'} disabled={!form.canVerify && form.busy !== 'verify'} />
        <View style={styles.actions}>
          <TextAction label={t('email_auth_edit_address')} color={C.bodyText} disabled={Boolean(form.busy)} onPress={form.changeEmail} />
          <TextAction label={form.resendSeconds > 0 ? t('email_auth_resend_in', [form.resendSeconds]) : t('email_auth_resend')}
            color={C.bodyText} disabled={!form.canSend} onPress={form.sendCode} />
        </View>
        {form.expired && <SourceText style={styles.hint} accessibilityLiveRegion="polite">{t('email_auth_expired')}</SourceText>}
      </>}
      {form.error && <SourceText accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{t(form.error)}</SourceText>}
      <TextAction testID="email_code_cancel" label={t('btn_cancel')} color={C.bodyText} disabled={!dismissible} onPress={close} />
    </ScrollView>
  </SourceDialog>;
}

const styles = StyleSheet.create({
  form: {gap: 12},
  input: {...T.body, color: C.text, minHeight: 48, borderWidth: 1, borderColor: C.buttonBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8},
  hint: {...T.metadata, color: C.secondaryText},
  error: {...T.metadata, color: C.validationError},
  actions: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'},
});
