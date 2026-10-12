import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ScreenSurface, SourceDialog, SourceIcon, SourceText, TextAction } from '../components';
import type { MobileScreenProps } from '../navigation/types';
import { useMobile } from '../runtime';
import {useTelemetry} from '../telemetry';
import { mobileColors as C, mobileTypography as T } from '../theme';
import { mobileTestIds as IDs } from '../theme/testIds';
import {fixtureActions} from '../components/fixture-actions';

export function FeedbackScreen({navigation, route}: MobileScreenProps<'Feedback'>) {
  const {t, repositories, api, config, fixtureOnly} = useMobile();
  const telemetry = useTelemetry();
  const [content, setContent] = useState(''), [followUp, setFollowUp] = useState(true), [busy, setBusy] = useState(false);
  const [user, setUser] = useState<Record<string, unknown>>({}), [title, setTitle] = useState(route.params?.title ?? '');
  const [result, setResult] = useState<{ok: boolean; message?: string} | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => repositories?.watchUser(rows => setUser(rows[0] ?? {})), [repositories]);
  useEffect(() => { let active = true; const id = route.params?.bookmarkId; setTitle(route.params?.title ?? ''); if (!route.params?.title && id) void repositories?.getBookmark(id).then(value => { if (active) setTitle(value?.aliasTitle || value?.title || ''); }).catch(() => {if (active) setTitle('');}); return () => {active = false;}; }, [repositories, route.params?.bookmarkId, route.params?.title]);
  useEffect(() => () => request.current?.abort(), []);
  const submit = React.useCallback(async () => {
    if (!content.trim() || request.current) return;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      await api.sendFeedback({bookmark_uuid: route.params?.bookmarkId ?? '', entry_point: route.params?.entryPoint ?? '', type: 'parse_error', content: content.trim(), platform: 'app', environment: `${config.platform === 'ios' ? 'iOS' : 'Android'} ${config.buildNumber}`, version: `${config.version} (${config.buildNumber})`, allow_follow_up: followUp, target_url: route.params?.targetUrl ?? ''}, controller.signal);
      if (!controller.signal.aborted) {telemetry.firebase('feedback', 'submit_start', {scope: 'app'}); setResult({ok: true});}
    } catch (reason) { if (!controller.signal.aborted) setResult({ok: false, message: reason instanceof Error ? reason.message : ''}); }
    finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }, [api, config, content, followUp, route.params, telemetry]);
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return;
    return fixtureActions.subscribe('feedback', async action => {
      if (action.kind === 'type' && action.testID === IDs.FeedbackInput) {setContent(String(action.text)); return true;}
      if (action.kind === 'press' && action.testID === IDs.FeedbackSubmit) {if (!content.trim() || busy) throw new Error('Fixture feedback submit is disabled'); await submit(); return true;}
      return false;
    });
  }, [fixtureOnly, content, busy, submit]);
  useLayoutEffect(() => navigation.setOptions({title: t('feedback_title'), headerTitleAlign: 'center', headerRight: () => <TextAction testID={IDs.FeedbackSubmit} label={t(busy ? 'feedback_submitting' : 'feedback_submit')} onPress={() => void submit()} disabled={!content.trim() || busy} style={{fontSize: 14, fontWeight: '600'}} />}), [navigation, t, busy, content, submit]);
  function dismiss() { const success = result?.ok; setResult(null); if (success) navigation.goBack(); }
  return <ScreenSurface testID={IDs.FeedbackScreen} bottomInset={Platform.OS !== 'android'} sourceAppBar>
    <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {title ? <View style={styles.article}><SourceText numberOfLines={1} style={{fontSize: 16, lineHeight: 22, fontWeight: '500'}}>{title}</SourceText>{route.params?.targetUrl ? <SourceText numberOfLines={1} style={[T.metadata, {color: C.link, marginTop: 4}]}>{route.params.targetUrl}</SourceText> : null}</View> : null}
      <View style={styles.editor}><TextInput testID={IDs.FeedbackInput} accessibilityLabel={t('feedback_placeholder')} value={content} onChangeText={setContent} multiline placeholder={t('feedback_placeholder')} placeholderTextColor="#0000004D" selectionColor={C.accent} style={styles.input} textAlignVertical="top" /></View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{checked: followUp}} onPress={() => setFollowUp(value => !value)} style={styles.followUp}><SourceIcon name={followUp ? 'ic_agree_enable' : 'ic_agree_disable'} size={12} /><SourceText style={[T.metadata, {color: C.secondaryText, flexShrink: 1}]}>{t('feedback_allow_follow_up', {email: String(user.email ?? '')})}</SourceText></Pressable>
    </KeyboardAvoidingView>
    <SourceDialog visible={result !== null} onDismiss={dismiss} title={t(result?.ok ? 'feedback_success_title' : 'feedback_error_title')} actions={<TextAction label={t('btn_ok')} onPress={dismiss} />}><SourceText>{result?.ok ? t('feedback_success_message') : `${t('feedback_error_message')} ${result?.message ?? ''}`}</SourceText></SourceDialog>
  </ScreenSurface>;
}
const styles = StyleSheet.create({article: {paddingHorizontal: 12, paddingVertical: 20}, editor: {flex: 1, marginHorizontal: 12, borderRadius: 16, backgroundColor: C.readerBackground, borderWidth: 1, borderColor: '#0F14190F', paddingHorizontal: 16, paddingVertical: 20}, input: {flex: 1, padding: 0, fontSize: 15, lineHeight: 22.5, color: C.bodyText, includeFontPadding: false}, followUp: {padding: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4}});
