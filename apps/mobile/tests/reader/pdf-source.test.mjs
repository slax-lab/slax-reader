import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {parseReaderMark, parseReaderMessage, parseReaderSelection, ReaderBridgeSession} from '../../src/reader/bridge.ts'
import {buildReaderMarks, htmlPaths, readerPaths, refreshSelectedMark, selectionForMark, selectionPaths, sourceStableId, sourceStrokeToRemove} from '../../src/reader/model.ts'

const documentId = 'a'.repeat(64)
const otherDocumentId = 'b'.repeat(64)
const quad = [12.25, 81, 92.5, 81, 12.25, 70.75, 92.5, 70.75]
const source = [
  {type: 'pdf', version: 1, document_id: documentId, page: 2, text: 'First line\nsecond line', quads: [quad, quad.map(point => point + 15)]},
  {type: 'pdf', version: 1, document_id: documentId, page: 3, text: 'Next page', quads: [quad]},
]
const text = source.map(path => path.text).join('\n')
const approx = {exact: text, raw_text: text, prefix: 'Before', suffix: 'After', position_start: 0, position_end: text.length}
const selection = {source, text, select_content: [{type: 'text', text, src: ''}], approx_source: approx}
const mark = {id: 'pdf-group', source, approx, stroke: [{mark_id: sourceStableId('own'), userId: sourceStableId('reader-user')}], comments: []}
const policy = {isCollection: false, showMarks: true, allowLine: true, allowComment: true, showProfile: true}
const record = (id, type = 1, paths = source, metadata = {}, deleted = 0) => ({id, type, metadata: JSON.stringify({user_id: 'reader-user', ...metadata}), is_deleted: deleted,
  source: JSON.stringify(paths), approx_source: JSON.stringify(approx), content: JSON.stringify(selection.select_content), comment: `comment:${id}`,
  user_bookmark_uuid: 'pdf-bookmark', created_at: '2026-01-01T00:00:00Z'})
const wrap = (payload, pageId = 'account:pdf-page') => JSON.stringify({channel: 'slax-reader', pageId, payload})

const invalidSources = [
  [{...source[0], version: 2}],
  [{...source[0], page: 0}],
  [{...source[0], page: 1.5}],
  [{...source[0], page: 100001}],
  [{...source[0], document_id: 'not-a-sha256'}],
  [{...source[0], text: '  '}],
  [{...source[0], quads: []}],
  [{...source[0], quads: [[1, 2, 3, 4]]}],
  [{...source[0], quads: [[...quad.slice(0, 7), Infinity]]}],
  [{...source[0], quads: [[...quad.slice(0, 7), NaN]]}],
  [{...source[0], quads: [[...quad.slice(0, 7), 1e7 + 1]]}],
  [{...source[0], quads: [[...quad.slice(0, 7), '80']]}],
  [source[0], {...source[1], document_id: otherDocumentId}],
  [source[0], {type: 'text', path: 'p', start: 0, end: 3}],
  [source[0], {type: 'text', xpath: 'p', start_offset: 0, end_offset: 3}],
  [source[0], null],
]

test('PDF sources round-trip native capture, persistence transport, mark events and selection without geometry loss', async () => {
  const session = new ReaderBridgeSession('account:pdf-page', async script => vm.runInNewContext(script, {window: {__SlaxReaderHost: {execute(command) {
    assert.equal(command.operation, 'captureSelection')
    return JSON.stringify({pageId: command.pageId, requestId: command.requestId, status: 'fulfilled', value: selection})
  }}}}))
  session.receive(wrap({type: 'domReady'}))
  try {
    const captured = parseReaderSelection(await session.request({operation: 'captureSelection'}), documentId)
    const persisted = selectionPaths(captured)
    assert.deepEqual(persisted, source)
    const rows = [record('own', 1, persisted), record('comment', 2, persisted), record('reply', 3, persisted, {parent_id: 'comment', root_id: 'comment'})]
    const detail = buildReaderMarks(rows, [], {id: 'reader-user', name: 'Reader'}, policy)
    assert.equal(detail.mark_list.length, 3)
    assert.deepEqual(detail.mark_list.map(item => item.source), [source, source, source])
    assert.equal(detail.mark_list[2].root_id, sourceStableId('comment'))
    const restored = parseReaderMark({...mark, source: detail.mark_list[0].source}, documentId)
    const event = session.receive(wrap({type: 'textSelected', text, data: JSON.stringify(restored)}))
    assert.deepEqual(event.mark.source, source)
    assert.equal(event.text, text)
    assert.deepEqual(selectionPaths(selectionForMark(event.mark)), source)
    assert.deepEqual(parseReaderSelection(selectionForMark({...restored, approx: null})).source, source)
    assert.equal(selectionForMark({...restored, approx: null}, 'wrong fallback').text, text)
    assert.deepEqual(buildReaderMarks(rows, [], {}, {...policy, showMarks: false}).mark_list, [])
  } finally { session.dispose() }
})

test('PDF validation rejects malformed geometry, mixed source kinds and mismatched document segments atomically', () => {
  for (const paths of invalidSources) {
    const invalid = {...mark, source: paths}
    assert.equal(parseReaderMark(invalid), null)
    assert.throws(() => parseReaderSelection({...selection, source: paths}), /Invalid selection/)
    assert.equal(readerPaths(paths), null)
    assert.deepEqual(buildReaderMarks([record('invalid', 1, paths)], [], {}, policy).mark_list, [])
    assert.throws(() => selectionPaths({...selection, source: paths}), /Invalid PDF/)
    assert.throws(() => selectionForMark(invalid), /Invalid PDF/)
    assert.equal(sourceStrokeToRemove([record('invalid', 1, paths)], invalid, 'reader-user'), null)
    assert.equal(refreshSelectedMark(mark, [invalid, mark]), mark)
    assert.deepEqual(refreshSelectedMark(invalid, [invalid, mark]), {...invalid, id: '', stroke: [], comments: []})
  }
  assert.equal(parseReaderMark(mark, otherDocumentId), null)
  assert.throws(() => parseReaderSelection(selection, otherDocumentId), /Invalid selection/)
  assert.equal(readerPaths(source, otherDocumentId), null)
  assert.deepEqual(readerPaths(JSON.stringify(source), documentId), source)
})

test('normalized reader output excludes invalid PDF roots without converting them to approximate HTML marks', () => {
  const htmlSource = [{type: 'text', path: 'p', start: 0, end: text.length}]
  const html = {...mark, id: 'html', source: htmlSource}
  for (const paths of invalidSources) {
    const invalid = [1, 2, 4, 5].map(type => record(`invalid-${type}`, type, paths))
    const rows = [...invalid, record('valid-pdf', 1), record('legacy-approx', 2, [])]
    const detail = buildReaderMarks(rows, [], {}, policy)
    assert.deepEqual(detail.mark_list.map(item => item.uuid), ['valid-pdf', 'legacy-approx'])
    const rendered = detail.mark_list.map(item => parseReaderMark({id: item.uuid, source: item.source, approx: item.approx_source, stroke: [], comments: []}))
    assert.ok(rendered.every(Boolean))
    const legacy = rendered.find(item => item.id === 'legacy-approx')
    assert.deepEqual(legacy.source, [])
    assert.equal(refreshSelectedMark(legacy, [html]), html, 'Legitimate approximate-only HTML marks still restore')
    assert.equal(sourceStrokeToRemove(rows, legacy, 'reader-user'), null, 'An empty source cannot delete an invalid PDF')
    assert.equal(sourceStrokeToRemove(invalid, html, 'reader-user'), null)
    assert.equal(sourceStrokeToRemove(invalid, mark, 'reader-user'), null)
    assert.equal(sourceStrokeToRemove([record('legacy-empty-line', 1, [])], legacy, 'reader-user'), null)
    assert.deepEqual(refreshSelectedMark({...html, id: 'invalid-1'}, rendered.filter(item => item.id !== 'legacy-approx')), {...html, id: '', stroke: [], comments: []})
  }
})

test('invalid PDF strokes and reply geometry do not discard valid comment threads or deleted ancestors', () => {
  const bad = [{...source[0], quads: []}]
  const rows = [record('invalid-line', 1, bad), record('root', 2, source, {}, 1),
    record('middle', 3, bad, {parent_id: 'root', root_id: 'root'}, 1),
    record('reply', 3, [], {parent_id: 'middle', root_id: 'root'}),
    record('second-root', 2), record('second-reply', 3, source, {parent_id: 'second-root', root_id: 'second-root'})]
  const detail = buildReaderMarks(rows, [], {}, policy)
  assert.deepEqual(detail.mark_list.map(item => item.uuid), ['root', 'middle', 'reply', 'second-root', 'second-reply'])
  const root = detail.mark_list.find(item => item.uuid === 'root')
  const middle = detail.mark_list.find(item => item.uuid === 'middle')
  const reply = detail.mark_list.find(item => item.uuid === 'reply')
  assert.deepEqual(root.source, source)
  assert.equal(root.is_deleted, true)
  assert.equal(middle.source, root.id, 'A malformed reply uses its existing parent reference, never an approximate empty root')
  assert.equal(middle.approx_source, null)
  assert.equal(middle.is_deleted, true)
  assert.equal(middle.root_id, root.id)
  assert.equal(reply.parent_id, middle.id)
  assert.equal(reply.root_id, root.id)
  assert.equal(parseReaderMark({...mark, source: middle.source}), null)
  assert.deepEqual(detail.mark_list.find(item => item.uuid === 'second-reply').source, source)
})

test('PDF paths canonicalize property order and omit incidental fields without changing exact coordinates', () => {
  const shuffled = source.map(path => ({quads: path.quads, text: path.text, page: path.page, document_id: path.document_id, version: 1, type: 'pdf', incidental: true}))
  assert.equal(JSON.stringify(readerPaths(shuffled)), JSON.stringify(readerPaths(source)))
  assert.equal(JSON.stringify(selectionPaths({...selection, source: shuffled})), JSON.stringify(readerPaths(source)))
  const normalized = readerPaths(source)
  normalized[0].quads[0][0] = 0
  assert.equal(source[0].quads[0][0], 12.25, 'Canonical paths do not alias input geometry')
  assert.deepEqual(htmlPaths(source), [], 'The historical HTML helper remains HTML-only')
})

test('PDF bridge events retain stale-page and released-session rejection for selection and mark updates', () => {
  const events = [
    {type: 'textSelected', text, data: mark},
    {type: 'markClicked', text, markId: mark.id, data: mark},
    {type: 'markItemInfosChanged', markItemInfos: JSON.stringify([mark, {...mark, id: 'second'}])},
  ]
  const session = new ReaderBridgeSession('account:pdf-page', async () => null)
  for (const payload of events) {
    const parsed = parseReaderMessage(wrap(payload), 'account:pdf-page')
    assert.equal(parsed.type, payload.type)
    if (parsed.type === 'markItemInfosChanged') assert.deepEqual(parsed.marks.map(item => item.source), [source, source])
    else assert.deepEqual(parsed.mark.source, source)
    assert.equal(session.receive(wrap(payload, 'old-account:pdf-page')), null)
  }
  assert.equal(parseReaderMessage(wrap({type: 'markItemInfosChanged', markItemInfos: [{...mark, source: invalidSources[0]}]}), 'account:pdf-page'), null)
  session.dispose()
  for (const payload of events) assert.equal(session.receive(wrap(payload)), null)
})

test('PDF reconciliation requires exact document, page, text and all quads even for a reused group ID', () => {
  const fresh = {...mark, id: '', stroke: [], comments: []}
  assert.equal(refreshSelectedMark(fresh, [mark]), mark)
  const recreated = {...mark, id: 'recreated'}
  assert.equal(refreshSelectedMark(mark, [recreated]), recreated)
  const mismatches = [
    source.map(path => ({...path, document_id: otherDocumentId})),
    [{...source[0], page: 4}, source[1]],
    [{...source[0], text: source[0].text + ' '}, source[1]],
    [{...source[0], quads: [[...quad.slice(0, 7), quad[7] + 0.00001], source[0].quads[1]]}, source[1]],
    [{...source[0], quads: [quad]}, source[1]],
    [source[1], source[0]],
    [source[0]],
    [],
    [{type: 'text', path: 'p', start: 0, end: text.length}],
  ]
  for (const paths of mismatches) {
    const different = {...mark, source: paths}
    assert.equal(refreshSelectedMark(fresh, [different]), fresh)
    assert.deepEqual(refreshSelectedMark(mark, [different]), fresh, 'Matching approx and group ID cannot repair a different PDF source')
    assert.equal(refreshSelectedMark(mark, [different, recreated]), recreated)
  }
  assert.equal(refreshSelectedMark(fresh, [mark, recreated]), fresh, 'Ambiguous exact sources cannot use approximate fallback')
  const html = {...fresh, source: [{type: 'text', path: 'p', start: 0, end: text.length}]}
  assert.equal(refreshSelectedMark(html, [mark]), html, 'PDF marks cannot enter the HTML approximate fallback')
})

test('PDF stroke removal matches stable exact source and current user while retaining comments and replies', () => {
  const shuffled = source.map(path => ({page: path.page, text: path.text, quads: path.quads, version: 1, document_id: path.document_id, type: 'pdf'}))
  const own = record('own', 1, shuffled)
  const rows = [record('origin', 4), record('other', 1, source, {user_id: 'someone-else'}), record('deleted', 1, source, {}, 1), record('comment', 2), record('reply', 3, source, {parent_id: 'comment', root_id: 'comment'}), own]
  assert.equal(sourceStrokeToRemove(rows, mark, 'reader-user'), own)
  assert.equal(sourceStrokeToRemove(rows, {...mark, source: shuffled}, 'reader-user'), own)
  assert.equal(sourceStrokeToRemove(rows.slice(0, -1), mark, 'reader-user'), null)
  assert.equal(sourceStrokeToRemove(rows, mark, ''), null)
  assert.equal(sourceStrokeToRemove(rows, {...mark, source: [{...source[0], page: 3}, source[1]]}, 'reader-user'), null)
  assert.equal(sourceStrokeToRemove(rows, {...mark, source: source.map(path => ({...path, document_id: otherDocumentId}))}, 'reader-user'), null)
  assert.equal(sourceStrokeToRemove(rows, {...mark, source: [{...source[0], text: 'Different'}, source[1]]}, 'reader-user'), null)
  assert.equal(sourceStrokeToRemove(rows, {...mark, source: [{...source[0], quads: [quad]}, source[1]]}, 'reader-user'), null)
  const after = buildReaderMarks(rows.map(row => row === own ? {...row, is_deleted: 1} : row), [], {}, policy)
  assert.deepEqual(after.mark_list.filter(item => [2, 3].includes(item.type)).map(item => item.uuid), ['comment', 'reply'])
})

test('legacy HTML parsing, path conversion and approximate-only marks remain unchanged', () => {
  const paths = [{type: 'text', path: 'p', start: 2, end: 5}, {type: 'image', path: 'img'}]
  const legacy = {...mark, source: paths}
  assert.deepEqual(readerPaths(paths), paths)
  assert.deepEqual(htmlPaths(paths), paths)
  assert.deepEqual(parseReaderMark(legacy), legacy)
  assert.deepEqual(selectionPaths(parseReaderSelection(selectionForMark(legacy))), paths)
  const approximateOnly = {...legacy, id: '', source: [], stroke: []}
  assert.equal(parseReaderMark(approximateOnly), approximateOnly)
  assert.equal(refreshSelectedMark(approximateOnly, [legacy]), legacy)
  assert.equal(parseReaderSelection(null), null)
})
