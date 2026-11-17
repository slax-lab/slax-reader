import type {TextInputInstance} from 'react-native'
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { isPossibleFeedUrl } from '@slax-reader/contracts/rss';
import { useMobile } from '../runtime';
import { mobileColors as C, mobileTypography as T } from '../theme';
import { mobileTestIds as IDs } from '../theme/testIds';
import { SourceButton, SourceDialog, SourceIcon, SourceText, TextAction } from './SourceUI';

const links = /(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/g;
type Mode = 'url' | 'feed' | 'file';

/**
 * Add Link dialog. Acquisition mode tabs appear only when the caller supplies the corresponding
 * feature gate, so bookmark-title editing keeps using the original single-input appearance.
 */
export function LinkInputDialog({visible, onDismiss, onSubmit, onSubmitFeed, onFeedAdded, feedError, initialTitle, initialMode = 'url', onImportPdf, rssEnabled = false}: {
  visible: boolean; onDismiss(): void; onSubmit(text: string): void; initialTitle?: string; initialMode?: Mode; onImportPdf?(): void;
  onSubmitFeed?(url: string, name: string): Promise<boolean>; onFeedAdded?(): void; feedError?: string | null; rssEnabled?: boolean;
}) {
  const {t, fixtureOnly, nativeResourceOwner} = useMobile(), edit = initialTitle !== undefined;
  const [text, setText] = useState(initialTitle ?? ''), [error, setError] = useState<{key: string; color: string} | null>(null);
  const [mode, setMode] = useState<Mode>('url'), [name, setName] = useState(''), [dismissed, setDismissed] = useState('');
  const [busy, setBusy] = useState(false), [feedFailed, setFeedFailed] = useState(false);
  const session = useRef(0), submitting = useRef(false), owner = useRef(nativeResourceOwner); owner.current = nativeResourceOwner;
  const input = useRef<TextInputInstance>(null), edited = useRef(false), pendingImport = useRef(false);
  const importCallback = useRef(onImportPdf); importCallback.current = onImportPdf;
  const completeImport = () => {if (pendingImport.current) {pendingImport.current = false; importCallback.current?.();}};
  const dismiss = () => {session.current++; submitting.current = false; setBusy(false); onDismiss();};
  const feedAvailable = !edit && rssEnabled && Boolean(onSubmitFeed), fileAvailable = !edit && Boolean(onImportPdf);
  const tabs: Mode[] = ['url', ...(feedAvailable ? ['feed'] as Mode[] : []), ...(fileAvailable ? ['file'] as Mode[] : [])];
  const available = tabs.includes(mode) ? mode : 'url';
  useEffect(() => {if (mode !== available) setMode('url');}, [mode, available]);
  useEffect(() => {if (visible) pendingImport.current = false;}, [visible]);
  useEffect(() => {
    if (!visible && pendingImport.current && Platform.OS !== 'ios') {const timer = setTimeout(completeImport, 200); return () => clearTimeout(timer);}
  }, [visible]);
  useEffect(() => {
    session.current++; submitting.current = false; setBusy(false); setFeedFailed(false);
    if (!visible) return; setText(initialTitle ?? ''); setError(null); edited.current = false; setMode(tabs.includes(initialMode) ? initialMode : 'url'); setName(''); setDismissed(''); let active = true;
    const timer = setTimeout(() => {
      input.current?.focus();
      if (!edit) void (fixtureOnly ? Promise.resolve('') : Clipboard.getStringAsync()).then(value => {
        if (!active || edited.current || !value) return; const matches = value.match(links) ?? [];
        if (matches.length > 1) setError({key: 'add_link_error_multiple_links', color: C.warning});
        else if (matches.length === 1) setText(matches[0]!);
      }).catch(() => undefined);
    }, edit ? 100 : 350);
    return () => {session.current++; active = false; clearTimeout(timer);};
  }, [visible, initialTitle, initialMode, edit, fixtureOnly, nativeResourceOwner]);
  const trimmed = text.trim(), httpUrl = /^https?:\/\//.test(trimmed);
  const hint = feedAvailable && available === 'url' && trimmed !== dismissed && isPossibleFeedUrl(trimmed);
  function switchMode(next: Mode) {if (!submitting.current) {setMode(next); setError(null);}}
  async function submit() {
    if (submitting.current || !visible) return;
    const value = text.trim();
    if (available === 'file') {pendingImport.current = true; input.current?.blur(); dismiss(); return;}
    if (edit && !value) return;
    if (!edit && !httpUrl) {setError({key: 'add_link_error_invalid_url', color: C.validationError}); return;}
    if (available === 'feed') {
      if (!onSubmitFeed) return;
      const stamp = session.current, account = nativeResourceOwner;
      const current = () => session.current === stamp && owner.current === account;
      submitting.current = true; edited.current = true; setBusy(true); setFeedFailed(false); setError(null);
      try {
        const ok = await onSubmitFeed(value, name.trim());
        if (!current()) return;
        if (ok) {onFeedAdded?.(); dismiss();} else setFeedFailed(true);
      } catch {if (current()) setFeedFailed(true);}
      finally {if (current()) {submitting.current = false; setBusy(false);}}
      return;
    }
    onSubmit(value); dismiss();
  }
  const shownError = error ?? ((available === 'feed' || available === 'url' && !feedAvailable) && feedFailed ? {key: `rss_error_${feedError ?? 'source_unavailable'}`, color: C.danger} : null);
  const label = available === 'feed' ? t('rss_add') : available === 'file' ? t('pdf_add_file') : t(edit ? 'btn_confirm' : 'add_link_btn_submit');
  return <SourceDialog visible={visible} onDismiss={dismiss} onDidDismiss={completeImport} compact testID={edit ? undefined : IDs.AddLinkDialog}>
    <View style={styles.header}><SourceText style={[T.dialogTitle, {fontWeight: '500'}]}>{t(edit ? 'edit_title_dialog_title' : 'add_content_dialog_title')}</SourceText><Pressable testID={edit ? undefined : IDs.AddLinkClose} accessibilityRole="button" accessibilityLabel={t('btn_close')} hitSlop={10} onPress={dismiss}><SourceIcon name="ic_xs_dialog_close" /></Pressable></View>
    {tabs.length > 1 ? <View accessibilityRole="tablist" style={styles.tabs}>
      {tabs.map(tab => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{selected: available === tab, disabled: busy}} disabled={busy} accessibilityLabel={t(`add_content_tab_${tab}`)} onPress={() => switchMode(tab)}
        style={styles.tab}><SourceText style={[styles.tabText, available === tab && styles.tabTextSelected]}>{t(`add_content_tab_${tab}`)}</SourceText></Pressable>)}
    </View> : null}
    {available !== 'file' ? <>
      <TextInput selectionColor={C.accent} cursorColor={C.accent} ref={input} testID={edit ? undefined : IDs.AddLinkInput} accessibilityLabel={t(edit ? 'edit_title_dialog_title' : available === 'feed' ? 'add_content_feed_placeholder' : 'add_link_placeholder')} value={text} editable={!busy} onChangeText={value => {edited.current = true; setText(value); setError(null); setFeedFailed(false);}} placeholder={edit ? undefined : available === 'feed' ? t('add_content_feed_placeholder') : t('add_link_placeholder')} placeholderTextColor={C.mutedText} autoCapitalize={edit ? 'sentences' : 'none'} autoCorrect={edit} returnKeyType="done" onSubmitEditing={submit} style={styles.input} />
      {hint ? <View style={styles.hint}>
        <SourceText style={[T.metadata, {color: C.bodyText}]}>{t('add_content_feed_hint')}</SourceText>
        <View style={styles.hintActions}>
          <TextAction testID="add-feed-switch" label={t('add_content_switch_feed')} disabled={busy} onPress={() => switchMode('feed')} style={{paddingHorizontal: 0}} />
          <TextAction testID="add-feed-keep" label={t('add_content_keep_url')} color={C.secondaryText} disabled={busy} onPress={() => setDismissed(trimmed)} style={{paddingHorizontal: 0}} />
        </View>
      </View> : null}
      {available === 'feed' ? <TextInput selectionColor={C.accent} cursorColor={C.accent} value={name} editable={!busy} onChangeText={value => {setName(value); setFeedFailed(false);}} maxLength={120} accessibilityLabel={t('add_content_feed_name')} placeholder={t('add_content_feed_name')} placeholderTextColor={C.mutedText} autoCapitalize="sentences" style={[styles.input, styles.nameInput]} /> : null}
    </> : null}
    {shownError ? <SourceText testID={IDs.AddLinkError} style={[T.metadata, {color: shownError.color, marginTop: 8}]}>{t(shownError.key)}</SourceText> : null}
    <SourceButton testID={edit ? undefined : IDs.AddLinkConfirm} label={label} busy={busy} onPress={submit} style={{marginTop: 24}} />
  </SourceDialog>;
}
const styles = StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 25, gap: 12},
  tabs: {height: 40, flexDirection: 'row', marginTop: 16},
  tab: {flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 8},
  tabText: {fontSize: 16, lineHeight: 20, color: C.mutedText, textAlign: 'center'},
  tabTextSelected: {color: C.text, fontWeight: '600'},
  input: {borderWidth: 1, borderColor: C.border, borderRadius: 8, minHeight: 50, paddingHorizontal: 12, paddingVertical: 10, marginTop: 25, ...T.body, color: C.bodyText, includeFontPadding: false},
  nameInput: {marginTop: 10},
  hint: {marginTop: 12, gap: 4},
  hintActions: {flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 2},
});
