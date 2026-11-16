import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, nativeBoundary, loadComponent, withNativeHost} from '../reader/parity-host.mjs';
import * as theme from '../../src/theme/index.ts';

for (const [locale, source] of [['en', 'Newsletter'], ['zh', '邮件通讯']]) test(`mounted ${locale} saved Newsletter search row shows its source and opens the bookmark`, nativeBoundary, async () => withNativeHost(async host => {
  const {createTranslator} = await loadComponent('../../src/i18n/index.ts', {});
  const {SearchArticleRow} = await loadComponent('../../src/search/SearchResultRow.tsx', {
    react: React, 'react-native': {...host.native, Text: host.native.View},
    '../components/AppImage': {AppImage: () => null}, '../components/SourceUI': host.components,
    './SearchSymbols': {SearchChevron: () => null}, '../theme': theme,
  });
  const article = {key: 'own:mail', kind: 'own', id: 'mail', title: 'Saved issue', description: 'Mail content', url: 'slax-newsletter://message/42', source: '', time: '2026-10-29'};
  const opened = [];
  await host.render(React.createElement(SearchArticleRow, {article, nested: false, query: '', t: createTranslator(locale), onOpen: value => opened.push(value)}));
  const row = host.window.document.querySelector('[data-testid="search-result-own:mail"]');
  assert.ok(row.textContent.includes(source));
  assert.doesNotMatch(row.textContent, /message|slax-newsletter/);
  await act(async () => host.props.get('search-result-own:mail').onPress());
  assert.deepEqual(opened, [article]);
  await host.render(React.createElement(SearchArticleRow, {article: {...article, url: 'https://www.example.com/article'}, nested: false, query: '', t: createTranslator(locale), onOpen() {}}));
  assert.match(host.window.document.body.textContent, /example\.com/);
}));
