import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View} from 'react-native';
import {ScreenSurface, SourceDialog, SourceIcon, SourceText, TextAction} from '../components';
import type {MobileScreenProps} from '../navigation/types';
import {useFeedback} from '../feedback/useFeedback';
import {mobileColors as C, mobileTypography as T} from '../theme';
import {mobileTestIds as IDs} from '../theme/testIds';
import {fixtureActions} from '../components/fixture-actions';

export function FeedbackScreen({navigation, route}: MobileScreenProps<'Feedback'>) {
  const form = useFeedback(route.params);
  const {t, fixtureOnly, content, setContent, followUp, setFollowUp, attachLogs, setAttachLogs, busy, ownerChanged, user, title, result, setResult, submit} = form;
  const submitDisabled = !content.trim() || busy || ownerChanged;
  const surface = useRef<React.ComponentRef<typeof View>>(null), [keyboardOffset, setKeyboardOffset] = useState(0);
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return;
    return fixtureActions.subscribe('feedback', async action => {
      if (action.kind === 'type' && action.testID === IDs.FeedbackInput) {setContent(String(action.text)); return true;}
      if (action.kind === 'press' && action.testID === IDs.FeedbackSubmit) {if (!content.trim() || busy || ownerChanged) throw new Error('Fixture feedback submit is disabled'); await submit(); return true;}
      return false;
    });
  }, [fixtureOnly, content, busy, ownerChanged, submit, setContent]);
  useLayoutEffect(() => navigation.setOptions({
    title: t('feedback_title'), headerTitleAlign: 'center',
    headerRight: () => <TextAction testID={IDs.FeedbackSubmit} label={t(busy ? 'feedback_submitting' : 'feedback_submit')} disabled={submitDisabled} onPress={() => {Keyboard.dismiss(); void submit();}}/>,
  }), [navigation, t, busy, submitDisabled, submit]);
  function dismiss() {const success = result?.ok; setResult(null); if (success) navigation.goBack();}
  return <ScreenSurface testID={IDs.FeedbackScreen} sourceAppBar>
    <View testID="feedback-measured-surface" ref={surface} style={styles.fill} onLayout={() => surface.current?.measureInWindow((_x, y) => setKeyboardOffset(y))}>
      <KeyboardAvoidingView testID="feedback-keyboard-layout" style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={keyboardOffset}>
        <Pressable testID="feedback-form" accessible={false} onPress={Keyboard.dismiss} style={styles.form}>
          <ScrollView testID="feedback-scroll" style={styles.fill} bounces={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.editorContent}>
            {title ? <View style={styles.article}><SourceText numberOfLines={1} style={styles.title}>{title}</SourceText>{route.params?.targetUrl ? <SourceText numberOfLines={1} style={[T.metadata, {color: C.link, marginTop: 4}]}>{route.params.targetUrl}</SourceText> : null}</View> : null}
            <View style={styles.editor}><TextInput testID={IDs.FeedbackInput} accessibilityLabel={t('feedback_placeholder')} value={content} onChangeText={setContent} multiline submitBehavior="newline" scrollEnabled editable={!busy && !ownerChanged} placeholder={t('feedback_placeholder')} placeholderTextColor="#0000004D" selectionColor={C.accent} style={styles.input} textAlignVertical="top" /></View>
          </ScrollView>
          <View style={styles.options}>
            <Pressable testID="feedback-follow-up" accessibilityRole="checkbox" accessibilityLabel={t('feedback_follow_up', {email: String(user.email ?? '')})} accessibilityState={{checked: followUp, disabled: busy || ownerChanged}} disabled={busy || ownerChanged} onPress={() => setFollowUp(value => !value)} style={styles.checkbox}>
              <SourceIcon name={followUp ? 'ic_agree_enable' : 'ic_agree_disable'} size={12}/><SourceText style={[T.metadata, styles.checkboxText, {color: C.secondaryText}]}>{t('feedback_follow_up', {email: String(user.email ?? '')})}</SourceText>
            </Pressable>
            <View style={styles.divider}/>
            <Pressable testID="feedback-attach-logs" accessibilityRole="checkbox" accessibilityLabel={t('feedback_attach_logs')} accessibilityHint={t('feedback_attach_logs_disclosure')} accessibilityState={{checked: attachLogs, disabled: busy || ownerChanged}} disabled={busy || ownerChanged} onPress={() => setAttachLogs(value => !value)} style={styles.checkbox}>
              <SourceIcon name={attachLogs ? 'ic_agree_enable' : 'ic_agree_disable'} size={12}/><SourceText style={[T.metadata, styles.checkboxText, {color: C.secondaryText}]}>{t('feedback_attach_logs')}</SourceText>
            </Pressable>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </View>
    <SourceDialog visible={result !== null} onDismiss={dismiss} title={t(result?.ok ? 'feedback_success_title' : 'feedback_error_title')} actions={<TextAction label={t('btn_ok')} onPress={dismiss}/>}><SourceText>{result?.ok ? t('feedback_success_message') : `${t('feedback_error_message')} ${result?.message ?? ''}`}</SourceText></SourceDialog>
  </ScreenSurface>;
}
const styles = StyleSheet.create({
  fill: {flex: 1}, form: {flex: 1, padding: 16, gap: 12}, article: {paddingVertical: 8}, title: {fontSize: 16, lineHeight: 22, fontWeight: '500'},
  editorContent: {flexGrow: 1, gap: 12},
  editor: {flex: 1, minHeight: 96, overflow: 'hidden', borderRadius: 16, backgroundColor: C.readerBackground, borderWidth: 1, borderColor: '#0F14190F'},
  input: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, padding: 14, fontSize: 15, lineHeight: 22.5, color: C.bodyText, includeFontPadding: false},
  options: {flexShrink: 0},
  checkbox: {minHeight: 48, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10}, checkboxText: {flex: 1},
  divider: {height: StyleSheet.hairlineWidth, backgroundColor: C.border},
});
