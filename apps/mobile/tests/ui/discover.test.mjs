import assert from 'node:assert/strict';
import test from 'node:test';
import {DISCOVERY_MEDIA_TYPE} from '../../../../packages/contracts/src/collections.ts';
import {React, act, loadComponent, nativeBoundary, withNativeHost} from '../reader/parity-host.mjs';

test('Discover requests ranked cards and discards responses from a replaced account', nativeBoundary, () => withNativeHost(async host => {
  const pending = [];
  const api = {options: {baseUrl: 'https://reader.test'}, request(...args) {
    return new Promise(resolve => pending.push({args, resolve}));
  }};
  let account = 'first';
  const opened = [];
  const Pressable = ({children, onPress}) => React.createElement('button', {onClick: onPress}, children);
  const native = {...host.native, Pressable, Text: host.native.View, Platform: {OS: 'ios'},
    Linking: {openURL: async url => {opened.push(url);}}};
  const context = () => ({api, config: {webUrl: 'https://reader.test'}, session: {status: 'authenticated', session: {userId: account}}, t: key => key});
  const {DiscoverScreen} = await loadComponent('../../src/screens/DiscoverScreen.tsx', {
    react: React, 'react-native': native, '../components': {...host.components, ScreenSurface: native.View},
    '../runtime': {useMobile: context},
  });
  await host.render(React.createElement(DiscoverScreen));
  assert.deepEqual(structuredClone(pending[0].args.slice(0, 4)), ['/v1/recommendations/collections', 'GET', undefined, {limit: '36'}]);
  assert.deepEqual(structuredClone(pending[0].args[5]), {access: 'required', accept: DISCOVERY_MEDIA_TYPE});
  account = 'second';
  await host.render(React.createElement(DiscoverScreen));
  assert.equal(pending[0].args[4].aborted, true);
  const response = (code, title) => ({items: [{code, name: code, articles: [
    {bookmarkUuid: 'lead', title, url: 'https://reader.test/lead'},
    {bookmarkUuid: 'second', title: 'Sibling', url: 'https://reader.test/second'},
  ]}]});
  await act(async () => pending[1].resolve(response('new', 'Current lead')));
  await act(async () => pending[0].resolve(response('old', 'Retired lead')));
  assert.match(host.window.document.body.textContent, /Current lead.*Sibling/);
  assert.doesNotMatch(host.window.document.body.textContent, /Retired lead/);
  const links = host.window.document.querySelectorAll('button');
  assert.equal(links.length, 3);
  for (const link of links) link.click();
  assert.deepEqual(opened, ['https://reader.test/c/new', 'https://reader.test/b/lead', 'https://reader.test/b/second']);
}));
