import {useCallback, useEffect, useRef} from 'react';
import type {RefObject} from 'react';
import type {WebView} from 'react-native-webview';
import {File} from 'expo-file-system';
import {fixtureActions} from '../../components/fixture-actions';
import type {NoticeReadGate} from '../notice-read-gate';
import type {NoticeObserver} from '../useDeleteNotice';
import type {DeleteAccountState} from '../useDeleteAccountState';

export interface DeleteNoticeFixture {dataDirectory: string; deleteNoticeHtml?: string}

export function useDeleteNoticeObserver(fixture: DeleteNoticeFixture | undefined) {
  const events = useRef<object[]>([]);
  const directory = fixture?.dataDirectory;
  useEffect(() => { events.current = []; }, [directory]);
  const observe = useCallback<NoticeObserver>((kind, data, gate) => {
    if (__DEV__ && directory) events.current = [...events.current.slice(-15), {kind, ...data, gate}];
  }, [directory]);
  return Object.assign(observe, {events});
}

type Observer = NoticeObserver & {events?: RefObject<object[]>};

export function useDeleteAccountFixture({fixture, observer, gate, read, state, web}: {
  fixture: DeleteNoticeFixture | undefined;
  observer: Observer;
  gate: NoticeReadGate;
  read: boolean;
  state: DeleteAccountState;
  web: RefObject<WebView<unknown> | null>;
}) {
  useEffect(() => {
    if (!__DEV__ || !fixture) return;
    let active = true;
    const unsubscribe = fixtureActions.subscribe('delete-account', async action => {
      if (action.kind === 'inspect-notice') {
        if (!/\/slax-ui-fixtures\/[a-z0-9-]+\/$/.test(fixture.dataDirectory)) {
          throw new Error('Controlled notice directory is unavailable');
        }
        const marker = JSON.parse(await new File(fixture.dataDirectory, 'slax-fixture.json').text());
        if (!active) return true;
        if (!marker.controlledFixture || marker.fixtureVersion !== 1) throw new Error('Controlled notice marker is invalid');
        new File(fixture.dataDirectory, 'delete-notice.json').write(JSON.stringify({
          controlledFixture: true,
          fixtureVersion: 1,
          gate: gate.inspect(),
          read,
          busy: state.busy,
          confirm: state.confirm,
          events: observer.events?.current ?? [],
        }));
        return true;
      }
      if (action.kind === 'scroll') {
        web.current?.injectJavaScript(`document.querySelector(${JSON.stringify(String(action.target))})?.scrollIntoView(); true;`);
        return true;
      }
      if (action.kind === 'press-delete') {
        if (!state.canDelete) throw new Error('Fixture deletion is disabled until the notice has been read');
        state.askConfirmation();
        return true;
      }
      if (action.kind === 'confirm-delete') {
        if (!state.confirm || state.busy) throw new Error('Fixture deletion confirmation is not open');
        await state.remove();
        return true;
      }
      return false;
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [fixture, observer, gate, read, state, web]);
}
