import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { ScreenSurface, SourceButton, SourceDialog, SourceText, TextAction } from '../components';
import type { MobileScreenProps } from '../navigation/types';
import { useMobile } from '../runtime';
import { mobileColors as C } from '../theme';
import {fixtureActions} from '../components/fixture-actions';
import {fixtureDocument} from '../native/fixture-document';
import {NoticeReadGate, noticeGeometryScript} from './notice-read-gate';
import {deleteCurrentAccount} from '../domain/delete-account';
import {SessionChangedError} from '../domain/session';
import {File} from 'expo-file-system';

const deletionReasons: Record<string, string> = {
  active_subscription: '无法删除账号：您有正在进行的订阅，请先取消订阅后再试',
  stripe_connect_exists: '无法删除账号：您的账号关联了 Stripe Connect，请先解除关联',
  collection_has_subscribers: '无法删除账号：您的合集有订阅者，请先处理相关合集',
  active_collection_subscription: '无法删除账号：您订阅了某些合集，请先取消订阅',
  has_free_subscription_history: '无法删除账号：您有免费订阅记录，请联系客服处理',
};
export function DeleteAccountScreen({navigation}: MobileScreenProps<'DeleteAccount'>) {
  const {t, api, sessions, runtime, session, nativeResourceOwner, config, fixtureOnly} = useMobile();
  const ownerAtMount = useRef(nativeResourceOwner).current;
  const userAtMount = useRef(session.status === 'authenticated' ? session.session.userId : null).current;
  const mounted = useRef(true);
  const isActive = () => {
    const current = sessions.getSnapshot();
    return mounted.current && current.status === 'authenticated' && current.session.userId === userAtMount
      && (Boolean(fixtureOnly) || Boolean(ownerAtMount && runtime.getNativeResourceOwner() === ownerAtMount));
  };
  const [read, setRead] = useState(false), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const web = useRef<WebView>(null);
  const noticeUrl = `${config.webUrl.replace(/\/$/, '')}/delete-account-notice`;
  const noticeGate = React.useMemo(() => new NoticeReadGate(noticeUrl, !!fixtureOnly?.deleteNoticeHtml), [noticeUrl, fixtureOnly?.deleteNoticeHtml]);
  const fixtureNoticeEvents = useRef<object[]>([]);
  function recordNotice(kind: string, data: object = {}) {
    if (!__DEV__ || !fixtureOnly) return;
    fixtureNoticeEvents.current = [...fixtureNoticeEvents.current.slice(-15), {kind, ...data, gate: noticeGate.inspect()}];
  }
  function resetNotice(failed = false) {if (failed) noticeGate.fail(); else noticeGate.beginLoad(); recordNotice(failed ? 'load-error' : 'load-start'); setRead(false); setConfirm(false);}
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; request.current?.abort();};}, []);
  useLayoutEffect(() => navigation.setOptions({title: t('delete_account_title'), headerTitleAlign: 'left', headerTitleStyle: {fontSize: 20, fontWeight: '500', color: C.text}}), [navigation, t]);
  async function remove() {
    if (!isActive() || !noticeGate.canDelete || request.current) return;
    setConfirm(false); setBusy(true); const controller = new AbortController(); request.current = controller;
    try {
      const response = await deleteCurrentAccount({api, sessions, signal: controller.signal, isActive});
      if (controller.signal.aborted || !isActive()) return;
      if (!response?.canDelete) setError(deletionReasons[String(response?.reason)] ?? '无法删除账号，原因未知');
    } catch (reason) { if (!controller.signal.aborted && !(reason instanceof SessionChangedError) && isActive()) setError(reason instanceof Error ? reason.message : '删除账号时发生未知错误'); }
    finally { request.current = null; if (!controller.signal.aborted && isActive()) setBusy(false); }
  }
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return;
    return fixtureActions.subscribe('delete-account', async action => {
      if (action.kind === 'inspect-notice') {
        if (!fixtureOnly.dataDirectory || !/\/slax-ui-fixtures\/[a-z0-9-]+\/$/.test(fixtureOnly.dataDirectory)) throw new Error('Controlled notice directory is unavailable');
        const marker = JSON.parse(await new File(fixtureOnly.dataDirectory, 'slax-fixture.json').text());
        if (!marker.controlledFixture || marker.fixtureVersion !== 1) throw new Error('Controlled notice marker is invalid');
        new File(fixtureOnly.dataDirectory, 'delete-notice.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, gate: noticeGate.inspect(), read, busy, confirm, events: fixtureNoticeEvents.current}));
        return true;
      }
      if (action.kind === 'scroll') {web.current?.injectJavaScript(`document.querySelector(${JSON.stringify(String(action.target))})?.scrollIntoView(); true;`); return true;}
      if (action.kind === 'press-delete') {if (!read || busy) throw new Error('Fixture deletion is disabled until the notice has been read'); setConfirm(true); return true;}
      if (action.kind === 'confirm-delete') {if (!confirm || busy) throw new Error('Fixture deletion confirmation is not open'); await remove(); return true;}
      return false;
    });
  }, [fixtureOnly, read, busy, confirm, api, sessions]);
  return <ScreenSurface sourceAppBar>
    <WebView ref={web} source={fixtureOnly?.deleteNoticeHtml ? {html: fixtureDocument(fixtureOnly.deleteNoticeHtml), baseUrl: 'about:blank'} : {uri: noticeUrl}} style={{flex: 1, backgroundColor: C.background}} onLoadStart={() => resetNotice()} onError={() => resetNotice(true)} onHttpError={() => resetNotice(true)}
      onLoad={event => {const generation = noticeGate.loadSucceeded(event.nativeEvent.url); recordNotice('load-success', {url: event.nativeEvent.url, generation}); if (generation !== null) web.current?.injectJavaScript(noticeGeometryScript(generation));}}
      onMessage={event => {try {const geometry = JSON.parse(event.nativeEvent.data); setRead(noticeGate.documentGeometry(event.nativeEvent.url, geometry)); recordNotice('document-geometry', {url: event.nativeEvent.url, geometry});} catch {recordNotice('invalid-document-geometry'); /* Incomplete document geometry cannot enable deletion. */}}}
      onScroll={({nativeEvent: {contentOffset, contentSize, layoutMeasurement}}) => {setRead(noticeGate.nativeGeometry(contentSize.height, layoutMeasurement.height, contentOffset.y)); recordNotice('native-geometry', {height: contentSize.height, visible: layoutMeasurement.height, y: contentOffset.y});}}
      onShouldStartLoadWithRequest={request => noticeGate.allows(request.url)} />
    <View style={styles.footer}><SourceButton label={t('delete_account_button')} disabled={!read || busy} busy={busy} tone="surface" destructive onPress={() => setConfirm(true)} /></View>
    <SourceDialog visible={confirm} onDismiss={() => setConfirm(false)} title={t('delete_account_confirm_title')} actions={<><TextAction label={t('btn_cancel')} color={C.bodyText} onPress={() => setConfirm(false)} /><TextAction label={t('delete_account_confirm_button')} color={C.danger} disabled={busy} onPress={() => void remove()} /></>}><SourceText>{t('delete_account_confirm_message')}</SourceText></SourceDialog>
    <SourceDialog visible={error !== null} dismissible={false} onDismiss={() => setError(null)} title={t('delete_account_error_title')} actions={<TextAction label={t('btn_ok')} color={C.bodyText} onPress={() => setError(null)} />}><SourceText>{error}</SourceText></SourceDialog>
  </ScreenSurface>;
}
const styles = StyleSheet.create({footer: {paddingVertical: 30, paddingHorizontal: 24}});
