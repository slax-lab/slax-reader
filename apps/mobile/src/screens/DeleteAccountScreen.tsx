import type {NativeSyntheticEvent, NativeScrollEvent} from 'react-native';
import React, {useLayoutEffect, useRef} from 'react';
import type {WebView} from 'react-native-webview';
import type {MobileScreenProps} from '../navigation/types';
import {useMobile} from '../runtime';
import {mobileColors as C} from '../theme';
import {fixtureDocument} from '../native/fixture-document';
import {useAccountScope} from '../settings/account-scope';
import {useDeleteNotice} from '../settings/useDeleteNotice';
import {useDeleteAccountState} from '../settings/useDeleteAccountState';
import {DeleteAccountView} from '../settings/DeleteAccountView';
import {useDeleteAccountFixture, useDeleteNoticeObserver} from '../settings/development/useDeleteAccountFixture';

export function DeleteAccountScreen({navigation}: MobileScreenProps<'DeleteAccount'>) {
  const mobile = useMobile();
  const {t, api, sessions, config, fixtureOnly} = mobile;
  const scope = useAccountScope({...mobile, apiOrigin: config.apiUrl, fixture: Boolean(fixtureOnly)});
  const web = useRef<WebView<unknown>>(null);
  const noticeUrl = `${config.webUrl.replace(/\/$/, '')}/delete-account-notice`;
  const observer = useDeleteNoticeObserver(fixtureOnly);
  const notice = useDeleteNotice(noticeUrl, Boolean(fixtureOnly?.deleteNoticeHtml), observer);
  const state = useDeleteAccountState({api, sessions, scope, gate: notice.gate, read: notice.read});
  useDeleteAccountFixture({fixture: fixtureOnly, observer, gate: notice.gate, read: notice.read, state, web});
  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('delete_account_title'),
      headerTitleAlign: 'left',
      headerTitleStyle: {fontSize: 20, fontWeight: '500', color: C.text},
    });
  }, [navigation, t]);

  const resetNotice = (failed = false) => {
    state.dismissConfirmation();
    notice.reset(failed);
  };
  return <DeleteAccountView t={t} state={state} web={web} notice={{
    source: fixtureOnly?.deleteNoticeHtml
      ? {html: fixtureDocument(fixtureOnly.deleteNoticeHtml), baseUrl: 'about:blank'}
      : {uri: noticeUrl},
    onLoadStart: () => resetNotice(),
    onError: () => resetNotice(true),
    onHttpError: () => resetNotice(true),
    onLoad: event => {
      const script = notice.loaded(event.nativeEvent.url);
      if (script !== null) web.current?.injectJavaScript(script);
    },
    onMessage: event => notice.message(event.nativeEvent.url, event.nativeEvent.data),
    onScroll: ({nativeEvent: {contentOffset, contentSize, layoutMeasurement}}: NativeSyntheticEvent<NativeScrollEvent>) => {
      notice.scroll(contentSize.height, layoutMeasurement.height, contentOffset.y);
    },
    onShouldStartLoadWithRequest: request => notice.allows(request.url),
  }} />;
}
