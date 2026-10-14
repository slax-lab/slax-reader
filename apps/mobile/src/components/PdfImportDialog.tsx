import React, {useEffect, useRef, useState} from 'react';
import {AppState, Platform, View} from 'react-native';
import {File} from 'expo-file-system';
import {PDF_MAX_BYTES} from '@slax-reader/contracts/pdf';
import {useMobile} from '../runtime';
import {pickPdf, removePickedPdf, type PickedPdf} from '../native/pdf-import';
import {SourceButton, SourceDialog, SourceText, TextAction} from './SourceUI';
import {mobileTypography as T, mobileColors as C} from '../theme';

export function PdfImportDialog({visible, onDismiss, onSaved}: {visible: boolean; onDismiss(): void; onSaved(bookmarkId: string): void}) {
  const {api, runtime, repositories, nativeResourceOwner, t, fixtureOnly} = useMobile();
  const [file, setFile] = useState<PickedPdf | null>(null);
  const [picking, setPicking] = useState(false), [busy, setBusy] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState == null || AppState.currentState === 'active');
  const interaction = useRef(0);
  const [error, setError] = useState<string | null>(null), [savedId, setSavedId] = useState<string | null>(null);
  const retained = useRef<PickedPdf | null>(null), mounted = useRef(true), shown = useRef(visible);
  const request = useRef<AbortController | null>(null), pendingPicker = useRef(false), pendingOpen = useRef<string | null>(null);
  const callbacks = useRef({onDismiss, onSaved}); callbacks.current = {onDismiss, onSaved}; shown.current = visible;
  const owner = useRef(nativeResourceOwner).current;
  const active = () => mounted.current && runtime.getNativeResourceOwner() === owner;
  const release = () => {const previous = retained.current; retained.current = null; if (previous) void removePickedPdf(previous.uri).catch(() => undefined);};
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; request.current?.abort(); release();};}, []);
  useEffect(() => {
    if (!visible) {interaction.current++; request.current?.abort(); pendingPicker.current = false; release(); setFile(null); setSavedId(null); setError(null); setBusy(false); setPicking(false);}
  }, [visible]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state !== 'active' && request.current) {request.current.abort(); request.current = null; if (active()) {setBusy(false); setError('pdf_upload_background');}}
    });
    return () => listener.remove();
  }, [runtime, owner]);
  const choose = async () => {
    if (!pendingPicker.current || !shown.current || !active()) return;
    pendingPicker.current = false;
    const generation = interaction.current;
    const current = () => active() && shown.current && interaction.current === generation;
    try {
      if (fixtureOnly && !(__DEV__ && fixtureOnly.nativePdfImport === 'seeded-synthetic-only')) throw new Error('No file picker in controlled fixtures');
      const selected = await pickPdf();
      if (!current()) {if (selected) await removePickedPdf(selected.uri); return;}
      if (selected) {release(); retained.current = selected; setFile(selected); setError(null);}
    } catch {if (current()) setError('pdf_pick_failed');}
    finally {if (current()) setPicking(false);}
  };
  useEffect(() => {
    if (picking && Platform.OS !== 'ios') {const timer = setTimeout(() => {void choose();}, 250); return () => clearTimeout(timer);}
  }, [picking]);
  useEffect(() => {
    if (!savedId || !repositories || !foreground) return;
    let subscribed = true;
    return repositories.watchRows('SELECT id FROM sr_user_bookmark WHERE id = ?', [savedId], rows => {
      if (!subscribed || !rows.length || !active() || !shown.current) return;
      subscribed = false; pendingOpen.current = savedId; callbacks.current.onDismiss();
      if (Platform.OS !== 'ios') {const id = pendingOpen.current; pendingOpen.current = null; if (id) callbacks.current.onSaved(id);}
    }, () => {if (active()) setError('pdf_upload_sync_pending');});
  }, [savedId, repositories, runtime, owner, foreground]);
  async function upload() {
    if (!file || busy || savedId || !active()) return;
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > PDF_MAX_BYTES) {setError('pdf_size_invalid'); return;}
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(null);
    try {
      const labs = await api.rssLabs(controller.signal);
      if (controller.signal.aborted || !active() || !shown.current) return;
      if (!labs.features.some(feature => feature.key === 'pdf' && feature.enabled)) {setError('pdf_lab_disabled'); return;}
      const body = new File(file.uri);
      if (!body.exists || body.size <= 0 || body.size > PDF_MAX_BYTES) {setError('pdf_size_invalid'); return;}
      const result = await api.uploadPdf(body, file.name, controller.signal);
      if (controller.signal.aborted || !active() || !shown.current) return;
      setSavedId(result.bookmark_uid); release(); setFile(null);
    } catch {
      if (!controller.signal.aborted && active() && shown.current) setError('pdf_upload_failed');
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (active()) setBusy(false);
      }
    }
  }
  function didDismiss() {
    if (pendingPicker.current) {void choose(); return;}
    const id = pendingOpen.current; pendingOpen.current = null;
    if (id && active()) callbacks.current.onSaved(id);
  }
  return <SourceDialog visible={visible && !picking && foreground} title={t('pdf_import_title')} onDismiss={onDismiss} onDidDismiss={didDismiss}>
    <SourceText style={T.metadata}>{t('pdf_limit')}</SourceText>
    {file ? <View style={{gap: 4, marginTop: 16}}><SourceText numberOfLines={3}>{file.name}</SourceText><SourceText style={[T.helper, {color: C.mutedText}]}>{(file.size / 1024 / 1024).toFixed(2)} MiB</SourceText></View> : null}
    {savedId ? <View accessibilityLiveRegion="polite" style={{gap: 8, marginTop: 16}}><SourceText>{t('pdf_upload_complete')}</SourceText><SourceText style={T.metadata}>{t('pdf_upload_sync_pending')}</SourceText></View> : <>
      <TextAction label={t('pdf_pick')} disabled={busy} onPress={() => {pendingPicker.current = true; setPicking(true);}} />
      <SourceButton label={t(busy ? 'pdf_uploading' : 'pdf_upload')} busy={busy} disabled={!file} onPress={() => {void upload();}} />
    </>}
    {error ? <SourceText accessibilityLiveRegion="polite" style={[T.metadata, {color: C.danger, marginTop: 12}]}>{t(error)}</SourceText> : null}
    <TextAction label={t(busy ? 'rss_cancel' : 'btn_close')} onPress={onDismiss} />
  </SourceDialog>;
}
