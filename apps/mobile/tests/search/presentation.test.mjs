import test from 'node:test';
import assert from 'node:assert/strict';
import {searchRows, searchExcerpt, searchHost, searchTextRuns} from '../../src/search/presentation.ts';

const expanded = {collections: false, rss: false, articles: false};
const article = (kind, id) => ({kind, key: `${kind}:${id}`, id, collectionId: kind === 'collection' ? 'c' : undefined, subscriptionId: kind === 'rss' ? 'r' : undefined, title: 'Machine learning', description: '', url: 'https://example.com/article', source: 'Source', time: ''});
const sections = () => ({
  collections: [{key: 'collection:c', title: 'Collection', source: {id: 'c'}, items: [article('collection', 'c1')]}],
  feeds: [{key: 'rss:r', title: 'RSS', source: {id: 'r'}, items: [article('rss', 'r1'), article('rss', 'r2')]}],
  own: [article('own', 'o1')],
});

test('all article kinds become independent virtualized rows under their source', () => {
  const rows = searchRows(sections(), expanded);
  assert.deepEqual(rows.map(row => row.key), ['section:collections', 'collection:c', 'collection:c1', 'section:rss', 'rss:r', 'rss:r1', 'rss:r2', 'section:articles', 'own:o1']);
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
  assert.equal(rows.find(row => row.key === 'rss:r1').nested, true);
  assert.equal(rows.at(-1).nested, false);
});

test('scoping removes source/category repetition and preserves collapsible article results', () => {
  const rows = searchRows(sections(), expanded, {kind: 'rss', id: 'r'});
  assert.deepEqual(rows.map(row => row.key), ['section:articles', 'rss:r1', 'rss:r2']);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].scoped, true);
  assert.equal(rows[1].nested, false);
  assert.equal(searchRows(sections(), {...expanded, articles: true}, {kind: 'rss', id: 'r'}).length, 1);
  const collection = searchRows(sections(), expanded, {kind: 'collection', id: 'c'});
  assert.deepEqual(collection.map(row => row.key), ['section:articles', 'collection:c1']);
});

test('categories collapse independently and empty categories are omitted', () => {
  const rows = searchRows(sections(), {...expanded, rss: true});
  assert.ok(rows.some(row => row.key === 'collection:c1'));
  assert.ok(rows.some(row => row.key === 'own:o1'));
  assert.ok(!rows.some(row => row.key === 'rss:r1'));
  assert.deepEqual(searchRows({collections: [], feeds: [], own: []}, expanded), []);
});

test('excerpts show the matching context, strip markup and omit timestamp-only summaries', () => {
  const excerpt = searchExcerpt(`${'Intro '.repeat(40)}机器与人类如何协作${' tail'.repeat(50)}`, '机器');
  assert.ok(excerpt.includes('机器与人类'));
  assert.ok(excerpt.startsWith('…'));
  assert.ok(excerpt.length <= 152);
  assert.equal(searchExcerpt('<b>Text</b>&nbsp;[highlight]Machine[/highlight]', 'machine'), 'Text Machine');
  assert.equal(searchExcerpt('2026-10-16 12:02', ''), '');
});

test('highlighting treats punctuation literally, merges overlaps and preserves visible text', () => {
  for (const [text, query] of [['机器学习与机器协作', '机器'], ['A [x] and C++', '[x] C++'], ['Machine machine learning', 'machine learning'], ['Overlapping', 'over overlapping']]) {
    const runs = searchTextRuns(text, query);
    assert.equal(runs.map(run => run.text).join(''), text);
    assert.ok(runs.some(run => run.match));
  }
  assert.deepEqual(searchTextRuns('No selection', ''), [{text: 'No selection', match: false}]);
  assert.equal(searchHost('https://www.example.com/path?private=value'), 'example.com');
  assert.equal(searchHost('invalid'), '');
});
