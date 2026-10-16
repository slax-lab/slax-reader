import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceStableId, buildReaderMarks, visibleCommentIds, selectionPaths, selectionForMark, sourceStrokeToRemove, youtubeCues, activeYoutubeCue, cueTime, subscriptionActive, fixMarkdownLinks, StreamMarkdownProcessor } from '../../src/reader/model.ts'
import { markdownToHtml } from '../../src/reader/markdown.ts'

const policy = {isCollection: false, showMarks: true, allowLine: true, allowComment: true, showProfile: true}
const source = JSON.stringify([{type: 'text', path: 'div > p:first-child', start: 2, end: 8}])
const record = (id, type, metadata = {}, deleted = 0) => ({id, type, metadata: JSON.stringify({user_id: 'reader-user', ...metadata}), is_deleted: deleted,
  source, approx_source: JSON.stringify({exact: 'quoted text', prefix: '', suffix: '', position_start: 2, position_end: 13, raw_text: 'quoted text'}),
  content: '[]', comment: `comment:${id}`, user_bookmark_uuid: 'fixture-bookmark', created_at: '2026-01-01T00:00:00Z'})

test('source identity retains numeric ids and Kotlin UTF-16 hash; unsafe long IDs fail explicitly', () => {
  assert.equal(sourceStableId('42'), 42)
  assert.equal(sourceStableId(null), 0)
  assert.equal(sourceStableId('abc'), 96354)
  assert.equal(sourceStableId('😀'), 1772899)
  assert.throws(() => sourceStableId('9007199254740993'), /precision/)
})

test('deleted thread ancestors survive only while a visible descendant needs them, including cycle termination', () => {
  const root = record('root', 2, {}, 1)
  const middle = record('middle', 3, {parent_id: 'root', root_id: 'root'}, 1)
  const reply = record('reply', 3, {parent_id: 'middle', root_id: 'root'})
  assert.deepEqual([...visibleCommentIds([root, middle, reply])], ['root', 'middle', 'reply'])
  assert.equal(visibleCommentIds([root, middle, {...reply, is_deleted: 1}]).size, 0)
  assert.equal(visibleCommentIds([record('a', 3, {parent_id: 'b'}, 1), record('b', 3, {parent_id: 'a'}, 1)]).size, 0)
})

test('mark transport preserves source/group UUID identity and privacy while removing deleted strokes', () => {
  const rows = [record('stroke', 1), record('removed', 1, {}, 1), record('root', 2, {}, 1), record('reply', 3, {parent_id: 'root', root_id: 'root'})]
  const detail = buildReaderMarks(rows, [], {id: 'reader-user', name: 'Reader', picture: 'avatar'}, policy)
  assert.deepEqual(detail.mark_list.map(mark => mark.uuid), ['stroke', 'root', 'reply'])
  assert.deepEqual(detail.mark_list[0].source, JSON.parse(source))
  assert.equal(detail.mark_list[1].is_deleted, true)
  assert.equal(detail.mark_list[2].parent_id, sourceStableId('root'))
  assert.equal(detail.user_list[sourceStableId('reader-user')].username, 'Reader')
  const privateDetail = buildReaderMarks(rows, [], {id: 'reader-user', name: 'Reader'}, {...policy, showProfile: false})
  assert.equal(privateDetail.user_list[sourceStableId('reader-user')].username, '')
  assert.equal(buildReaderMarks(rows, [], {}, {...policy, showMarks: false}).mark_list.length, 0)
  assert.throws(() => buildReaderMarks([record('FB', 1), record('Ea', 2)], [], {}, policy), /collide/)
})

test('source selection wire spelling converts to persisted path offsets and historical quote fallback', () => {
  const capture = {source: [{type: 'text', xpath: 'p', start_offset: 4, end_offset: 10}, {type: 'image', xpath: 'img', start_offset: 0, end_offset: 0}]}
  assert.deepEqual(selectionPaths(capture), [{type: 'text', path: 'p', start: 4, end: 10}, {type: 'image', path: 'img'}])
  const legacy = selectionForMark({id: 'group', source: [{type: 'text', path: 'p', start: 4, end: 10}], stroke: [], comments: []}, 'quoted')
  assert.equal(legacy.text, 'quoted')
  assert.equal(legacy.approx_source.raw_text, 'quoted')
  assert.equal(legacy.source[0].start_offset, 4)
})

test('removing a stroke matches the complete selected range and never deletes another user or origin annotation', () => {
  const selected = {id: 'group', source: JSON.parse(source), stroke: [{mark_id: sourceStableId('own'), userId: sourceStableId('reader-user')}], comments: []}
  const own = record('own', 1)
  const rows = [record('origin', 4), record('other', 1, {user_id: 'someone-else'}), record('deleted', 1, {}, 1), own]
  assert.equal(sourceStrokeToRemove(rows, selected, 'reader-user'), own)
  assert.equal(sourceStrokeToRemove(rows, {...selected, source: [{type: 'text', path: 'div > p:first-child', start: 3, end: 5}]}, 'reader-user'), null)
  assert.equal(sourceStrokeToRemove(rows.slice(0, 3), selected, 'reader-user'), null)
  assert.equal(sourceStrokeToRemove(rows, selected, ''), null)
})

test('transcript attribute decoding retains source validation, time labels and active cue behavior', () => {
  const html = '<youtube-player data-cues="[{&quot;t&quot;:0,&quot;text&quot;:&quot;A &amp; B&quot;},{&quot;t&quot;:42,&quot;text&quot;:&quot;Second&quot;}]">'
  const cues = youtubeCues(html)
  assert.deepEqual(cues, [{t: 0, text: 'A & B'}, {t: 42, text: 'Second'}])
  assert.equal(activeYoutubeCue(cues, -1), -1)
  assert.equal(activeYoutubeCue(cues, 41), 0)
  assert.equal(activeYoutubeCue(cues, 42), 1)
  assert.equal(cueTime(3661), '1:01:01')
  assert.deepEqual(youtubeCues('<youtube-player data-cues="[{&quot;text&quot;:&quot;missing t&quot;}]">'), [])
  assert.equal(subscriptionActive([{subscription_end_time: '2027-01-01T00:00:00Z'}], Date.parse('2026-10-01T00:00:00Z')), true)
  assert.equal(subscriptionActive([{subscription_end_time: 'bad'}]), false)
})

test('outline link processing waits for streamed link completion and preserves nested anchors', () => {
  const processor = new StreamMarkdownProcessor()
  assert.equal(processor.process('Intro [A'), 'Intro ')
  assert.equal(processor.process('Intro [Anchor](#An (anchor))'), 'Intro ')
  assert.equal(processor.flush(), 'Intro [Anchor](#An%20%28anchor%29)')
  assert.equal(fixMarkdownLinks('[a](#already%28encoded%29)'), '[a](#already%28encoded%29)')
  assert.equal(fixMarkdownLinks('[a](#escaped\\) bracket)'), '[a](#escaped\\%29%20bracket)')
})

test('outline markdown preserves links, lists, code, table and quotes without activating raw scripts', () => {
  const html = markdownToHtml('# Heading\n\n[Jump](#A%20heading) **bold**\n\n- First\n- Second\n\n```js\n<script>malicious()</script>\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> Quote\n\n<script>attack()</script>\n[bad](javascript:alert(1))')
  assert.match(html, /<h1>Heading<\/h1>/)
  assert.match(html, /href="#A%20heading"/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<ul><li>First<\/li><li>Second<\/li><\/ul>/)
  assert.match(html, /<table>/)
  assert.match(html, /<blockquote>/)
  assert.doesNotMatch(html, /<script>|href="javascript:/)
  assert.match(html, /&lt;script&gt;attack\(\)&lt;\/script&gt;/)
})
