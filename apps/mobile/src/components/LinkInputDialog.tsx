import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useMobile } from '../runtime';
import { mobileColors as C, mobileTypography as T } from '../theme';
import { mobileTestIds as IDs } from '../theme/testIds';
import { SourceButton, SourceDialog, SourceIcon, SourceText } from './SourceUI';

const links = /(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/g;
export function LinkInputDialog({visible, onDismiss, onSubmit, initialTitle}: {visible: boolean; onDismiss(): void; onSubmit(text: string): void; initialTitle?: string}) {
  const {t, fixtureOnly} = useMobile(), edit = initialTitle !== undefined;
  const [text, setText] = useState(initialTitle ?? ''), [error, setError] = useState<{key: string; color: string} | null>(null);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (!visible) return; setText(initialTitle ?? ''); setError(null); let active = true;
    const timer = setTimeout(() => {
      input.current?.focus();
      if (!edit) void (fixtureOnly ? Promise.resolve('') : Clipboard.getStringAsync()).then(value => {
        if (!active || !value) return; const matches = value.match(links) ?? [];
        if (matches.length === 0) setError({key: 'add_link_error_no_clipboard', color: C.warning});
        else if (matches.length > 1) setError({key: 'add_link_error_multiple_links', color: C.warning});
        else setText(matches[0]!);
      }).catch(() => undefined);
    }, edit ? 100 : 350);
    return () => {active = false; clearTimeout(timer);};
  }, [visible, initialTitle, edit, fixtureOnly]);
  function submit() {
    const value = text.trim();
    if (edit && !value) return;
    if (!edit && !/^https?:\/\//.test(value)) {setError({key: 'add_link_error_invalid_url', color: C.validationError}); return;}
    onSubmit(value); onDismiss();
  }
  return <SourceDialog visible={visible} onDismiss={onDismiss} compact testID={edit ? undefined : IDs.AddLinkDialog}>
    <View style={styles.header}><SourceText style={[T.dialogTitle, {fontWeight: '500'}]}>{t(edit ? 'edit_title_dialog_title' : 'add_link_dialog_title')}</SourceText><Pressable testID={edit ? undefined : IDs.AddLinkClose} accessibilityRole="button" accessibilityLabel={t('btn_close')} hitSlop={10} onPress={onDismiss}><SourceIcon name="ic_xs_dialog_close" /></Pressable></View>
    <TextInput ref={input} testID={edit ? undefined : IDs.AddLinkInput} accessibilityLabel={t(edit ? 'edit_title_dialog_title' : 'add_link_placeholder')} value={text} onChangeText={value => {setText(value); setError(null);}} placeholder={edit ? undefined : t('add_link_placeholder')} placeholderTextColor={C.mutedText} autoCapitalize={edit ? 'sentences' : 'none'} autoCorrect={edit} selectionColor={C.accent} returnKeyType="done" onSubmitEditing={submit} style={styles.input} />
    {error ? <SourceText testID={IDs.AddLinkError} style={[T.metadata, {color: error.color, marginTop: 8}]}>{t(error.key)}</SourceText> : null}
    <SourceButton testID={edit ? undefined : IDs.AddLinkConfirm} label={t(edit ? 'btn_confirm' : 'add_link_btn_submit')} onPress={submit} style={{marginTop: 24}} />
  </SourceDialog>;
}
const styles = StyleSheet.create({header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 25, gap: 12}, input: {borderWidth: 1, borderColor: C.border, borderRadius: 8, minHeight: 50, paddingHorizontal: 12, paddingVertical: 10, marginTop: 25, ...T.body, color: C.bodyText, includeFontPadding: false}});
