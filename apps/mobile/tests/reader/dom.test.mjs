import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { composeReaderDocument } from '../../src/reader/document.ts'
import { parseReaderMessage, parseReaderSelection } from '../../src/reader/bridge.ts'
import {buildReaderMarks, sourceStableId, youtubeCues} from '../../src/reader/model.ts'
import {parseReaderInputSnapshot} from '../../src/reader/input.ts'

// Reuse an existing test runtime if available; do not add an optional mobile integration.
const require = createRequire(import.meta.url)
let domModule = process.env.SLAX_READER_DOM_MODULE
if (!domModule) {
  try { domModule = require.resolve('happy-dom', { paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname] }) } catch {}
}
const options = { skip: domModule ? false : 'Set SLAX_READER_DOM_MODULE to an existing happy-dom module to run DOM fixtures' }
const article = await readFile(new URL('./fixtures/mixed-article.html', import.meta.url), 'utf8')
const expectedSources = JSON.parse(await readFile(new URL('./fixtures/cross-paragraph-source.json', import.meta.url), 'utf8'))
const paths = expectedSources.map(item => ({ type: item.type, path: item.xpath, start: item.start_offset, end: item.end_offset }))

async function fixture(platform, content = article, setupWindow = () => {}, documentOptions = {}) {
  const { Window } = await import(pathToFileURL(domModule).href)
  const window = new Window({ url: 'https://reader.invalid', settings: {
    enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true,
    disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true,
  } })
  const messages = []
  let resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })
  window.ReactNativeWebView = { postMessage(message) {
    messages.push(JSON.parse(message))
    if (JSON.parse(message).payload.type === 'domReady') resolveReady()
  } }
  setupWindow(window)
  window.document.write(composeReaderDocument(content, { pageId: 'fixture', platform, ...documentOptions }))
  await ready
  let sequence = 0
  const execute = (operation, argument) => {
    const requestId = `test:${++sequence}`
    const result = JSON.parse(window.__SlaxReaderHost.execute({ pageId: 'fixture', requestId, operation, argument }))
    assert.equal(result.pageId, 'fixture')
    assert.equal(result.requestId, requestId)
    assert.equal(result.status, 'fulfilled', `Command ${operation} was acknowledged`)
    return result.value
  }
  execute('initialize', { currentUserId: 7, infoPack: {} })
  return { window, messages, execute, close: () => window.happyDOM.close() }
}

test('registered iOS source handler forwards the original monitor through a dynamic WK namespace once', options, async () => {
  let nativeMessages = 0
  const {window, messages, execute, close} = await fixture('ios', article, window => {
    const sourceHandler = {postMessage(raw) {
      nativeMessages++
      // Model the real native round trip, retaining its immutable page binding.
      setTimeout(() => window.__SlaxReaderHost.receiveSourceMessage(raw, 'fixture'), 0)
    }}
    const webkit = {}
    Object.defineProperty(webkit, 'messageHandlers', {get: () => ({NativeBridge: sourceHandler})})
    Object.defineProperty(window, 'webkit', {get: () => webkit})
  }, {observeInput: true})
  try {
    const first = window.document.querySelector('#first').firstChild
    const range = window.document.createRange(); range.setStart(first, 0); range.setEnd(first, 5)
    window.getSelection().addRange(range)
    const touch = type => {
      const event = new window.Event(type, {bubbles: true})
      Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', {value: [{clientX: 20, clientY: 40}]})
      first.parentNode.dispatchEvent(event)
    }
    touch('touchstart')
    window.document.dispatchEvent(new window.Event('selectionchange'))
    touch('touchend')
    await new Promise(resolve => setTimeout(resolve, 380))
    const selected = messages.map(message => parseReaderMessage(JSON.stringify(message), 'fixture')).filter(event => event?.type === 'textSelected')
    assert.equal(selected.length, 1)
    assert.equal(selected[0].text, 'Alpha')
    assert.equal(selected[0].selectionGeometry.touchClientY, 40)
    const snapshot = messages.filter(message => message.payload.type === 'inputObservation').at(-1).payload.snapshot
    assert.equal(snapshot.sourceSelections, 1, 'Native forwarding retains the existing host source counter')
    assert.equal(snapshot.lastSelectionTextLength, 5)
    assert.equal(snapshot.rangeInsideMonitor, true)
    assert.ok(nativeMessages >= 2, 'Both original domReady and selection use the real registered handler')
    assert.equal(window.__SlaxReaderHost.receiveSourceMessage('{"type":"tap"}', 'old-page'), false)
    execute('teardown')
    assert.equal(window.__SlaxReaderHost.receiveSourceMessage('{"type":"tap"}', 'fixture'), false)
    assert.equal(messages.filter(message => message.payload.type === 'textSelected').length, 1)
  } finally {await close()}
})

for (const platform of ['android', 'ios']) {
  test(`${platform} passive diagnostics preserve original mark guards and pending selection behavior`, options, async () => {
    const input = JSON.parse(await readFile(new URL('../data/adoption-fixtures/visible-legacy-inputs.json', import.meta.url), 'utf8'))
    const {window, messages, execute, close} = await fixture(platform,
      `<article id="controlled-offline"><p id="controlled-quote">${input.article.quote}</p></article>`, () => {}, {observeInput: true})
    const wait = () => new Promise(resolve => setTimeout(resolve, 380))
    const latest = () => messages.filter(item => item.payload.type === 'inputObservation').at(-1)?.payload.snapshot
    const sourceCount = type => messages.filter(item => item.payload.type === type).length
    const touch = (target, type, x, y) => {
      const event = new window.Event(type, {bubbles: true})
      Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', {value: [{clientX: x, clientY: y}]})
      target.dispatchEvent(event)
    }
    try {
      execute('drawMarks', buildReaderMarks([input.comment], [], {id: 'synthetic-user', name: 'Synthetic User', picture: ''}, {showMarks: true, showProfile: true}))
      const mark = window.document.querySelector('slax-mark')
      assert.ok(mark)
      mark.click()
      await wait()
      assert.equal(sourceCount('markClicked'), 0, 'Source binds touchend, so the observer must not translate click into a mark event')
      touch(mark, 'touchstart', 10, 10); touch(mark, 'touchend', 30, 10)
      await wait()
      assert.equal(sourceCount('markClicked'), 0, 'The unchanged source rejects a moved touch')
      assert.equal(latest().lastTouchMovedX, 20)
      assert.equal(latest().lastTargetClosestMark, true)
      assert.equal(latest().lastMarkInfoPresent, true)
      assert.equal(latest().lastMarkCommentCount, 1)
      touch(mark, 'touchstart', 10, 10); touch(mark, 'touchend', 10, 10)
      await wait()
      const clicked = messages.map(item => parseReaderMessage(JSON.stringify(item), 'fixture')).findLast(item => item?.type === 'markClicked')
      assert.equal(clicked.mark.comments[0].comment, 'Pending comment')
      assert.equal(latest().sourceMarkClicks, 1)
      assert.equal(latest().touchStarts, latest().bubbleTouchStarts)
      assert.equal(latest().touchEnds, latest().bubbleTouchEnds)
      touch(mark, 'touchstart', 10, 10)
      const range = window.document.createRange(); range.setStart(mark.firstChild, 0); range.setEnd(mark.firstChild, 10)
      window.getSelection().addRange(range); window.document.dispatchEvent(new window.Event('selectionchange'))
      await wait()
      assert.equal(latest().pointerDown, true)
      assert.equal(latest().pendingSelection, true)
      assert.equal(sourceCount('textSelected'), 0, 'Read-only snapshots must not process a held source selection')
      touch(mark, 'touchcancel', 10, 10)
      await wait()
      assert.equal(latest().pointerDown, false)
      assert.equal(latest().pendingSelection, true)
      assert.equal(sourceCount('textSelected'), 0, 'Source touchcancel alone does not drain its pending callback; retain that behavior')
      touch(mark, 'touchend', 10, 10)
      await wait()
      assert.equal(sourceCount('textSelected'), 1)
      assert.equal(latest().sourceSelections, 1)
      assert.equal(latest().lastSelectionTextLength, 10)
      assert.equal(latest().rangeInsideMonitor, true)
      assert.equal(sourceCount('markClicked'), 1, 'An expanded selection still suppresses the source mark tap')
      assert.equal(latest().lastTouchRangeCollapsed, false, 'Retain the actual guard state at touch dispatch, before later DOM changes')
      for (const item of messages.filter(item => item.payload.type === 'inputObservation')) {
        assert.ok(parseReaderInputSnapshot(item.payload.snapshot))
        assert.deepEqual(parseReaderMessage(JSON.stringify(item), 'fixture'), {type: 'inputObservation', snapshot: item.payload.snapshot})
        assert.ok(Object.values(item.payload.snapshot).every(value => value === null || typeof value === 'number' || typeof value === 'boolean'))
      }
      execute('teardown')
      const stopped = sourceCount('inputObservation')
      await wait()
      assert.equal(sourceCount('inputObservation'), stopped, 'Disposal cancels the passive observation timers')
    } finally {await close()}
  })

  test(`${platform} ordinary documents omit passive input observations`, options, async () => {
    const {window, messages, close} = await fixture(platform)
    try {
      window.document.dispatchEvent(new window.Event('touchcancel', {bubbles: true}))
      window.document.dispatchEvent(new window.Event('selectionchange'))
      await new Promise(resolve => setTimeout(resolve, 380))
      assert.equal(messages.filter(item => item.payload.type === 'inputObservation').length, 0)
    } finally {await close()}
  })

  test(`${platform} source bridge captures cross-paragraph ranges and restores overlapping marks/threads`, options, async () => {
    const { window, messages, execute, close } = await fixture(platform)
    try {
      assert.equal(window.document.querySelectorAll('table td').length, 2)
      assert.ok(window.document.querySelector('pre code'))
      assert.ok(window.document.querySelector('.katex'))
      const range = window.document.createRange()
      range.setStart(window.document.querySelector('#first').firstChild, 6)
      range.setEnd(window.document.querySelector('#second').firstChild, 6)
      window.getSelection().addRange(range)
      const selection = parseReaderSelection(execute('captureSelection'))
      assert.deepEqual(selection.source, expectedSources)
      assert.equal(selection.text, 'bold end.Second')
      assert.ok(selection.approx_source.prefix.endsWith('Alpha '))
      assert.ok(selection.approx_source.suffix.startsWith(' paragraph'))
      execute('clearSelection')
      const base = { user_id: 7, parent_id: 0, root_id: 0, comment: '', source: paths,
        created_at: '2026-01-01T00:00:00.000Z', is_deleted: false }
      const detail = {
        mark_list: [{ ...base, id: 10, type: 1 }, { ...base, id: 11, type: 2, comment: 'A fixture comment' },
          { ...base, id: 12, type: 3, source: 0, parent_id: 11, root_id: 11, comment: 'A threaded reply' }],
        user_list: { 7: { id: 7, username: 'Fixture User', avatar: '' } },
      }
      execute('drawMarks', detail)
      const marked = [...window.document.querySelectorAll('slax-mark')]
      assert.equal(marked.map(mark => mark.textContent).join(''), 'bold end.Second')
      assert.ok(marked.every(mark => mark.classList.contains('stroke') && mark.classList.contains('comment')))
      const event = messages.map(message => parseReaderMessage(JSON.stringify(message), 'fixture')).findLast(event => event?.type === 'markItemInfosChanged')
      assert.equal(event.marks[0].comments[0].children[0].comment, 'A threaded reply')
      const originalId = marked[0].dataset.uuid
      execute('drawMarks', detail)
      assert.equal(window.document.querySelector('slax-mark').dataset.uuid, originalId)
      execute('drawMarks', { mark_list: [], user_list: {} })
      assert.equal(window.document.querySelectorAll('slax-mark').length, 0)
      assert.equal(window.document.querySelector('#first').textContent, 'Alpha bold end.')
      execute('teardown')
      const count = messages.length
      window.SlaxWebViewBridge.postMessage({ type: 'tap' })
      assert.equal(messages.length, count)
      assert.equal(window.SlaxWebViewBridge.selectionMonitor, null)
    } finally { await close() }
  })
}

test('contextual recovery renders a legacy quote without changing its persisted source identity', options, async () => {
  const { window, messages, execute, close } = await fixture('ios')
  try {
    const source = [{ type: 'text', path: 'div > p#old-removed-id', start: 0, end: 16 }]
    execute('drawMarks', {
      mark_list: [{ id: 13, user_id: 7, type: 1, parent_id: 0, root_id: 0, comment: '', source,
        approx_source: { exact: 'Second paragraph', prefix: ' end.', suffix: ' with quote.' },
        created_at: '2026-01-01T00:00:00.000Z', is_deleted: false }], user_list: {},
    })
    assert.equal(window.document.querySelector('slax-mark').textContent, 'Second paragraph')
    const event = messages.map(message => parseReaderMessage(JSON.stringify(message), 'fixture')).findLast(event => event?.type === 'markItemInfosChanged')
    assert.deepEqual(event.marks[0].source, source)
  } finally { await close() }
})

test('fixture document commands are disabled in ordinary reader documents', options, async () => {
  const {window, messages, close} = await fixture('ios')
  try {
    const result = JSON.parse(window.__SlaxReaderHost.execute({pageId: 'fixture', requestId: 'disabled', operation: 'prepareFixture', argument: {kind: 'selection', source: paths}}))
    assert.equal(result.status, 'rejected')
    assert.equal(messages.some(message => message.payload.requestId === 'disabled'), false)
    assert.equal(window.getSelection().isCollapsed, true)
  } finally {await close()}
})
test('controlled fixture selection uses actual DOM Range and source serialization without fabricated mark events', options, async () => {
  const {window, execute, close} = await fixture('android', article, () => {}, {controlledFixture: true})
  try {
    execute('prepareFixture', {kind: 'selection', source: paths, selectedText: 'bold end.Second'})
    assert.equal(window.getSelection().toString(), 'bold end.Second')
    assert.deepEqual(parseReaderSelection(execute('captureSelection')).source, expectedSources)
  } finally {await close()}
})
for (const platform of ['android', 'ios']) {
  test(`${platform} shared native fixture resolves persisted comment IDs to generated range groups`, options, async () => {
    const bundle = JSON.parse(await readFile(new URL('../../fixtures/scenarios.json', import.meta.url), 'utf8'))
    const prepared = bundle.scenarios['reader-mixed']
    const content = await readFile(new URL('../../fixtures/articles/mixed.html', import.meta.url), 'utf8')
    const {window, messages, execute, close} = await fixture(platform, content, () => {}, {controlledFixture: true})
    try {
      const rows = prepared.payload.database
      const profiles = JSON.parse(JSON.parse(rows.ps_data_local__local_bookmark_info.find(row => row.id === bundle.ids.mixed).data).mark_users)
      const detail = buildReaderMarks(rows.sr_bookmark_comment, profiles, rows.sr_user[0], {showMarks: true, showProfile: true})
      execute('drawMarks', detail)
      const selection = prepared.actions.find(action => action.kind === 'selection')
      execute('prepareFixture', selection)
      assert.equal(window.getSelection().toString(), selection.selectedText)
      const captured = parseReaderSelection(execute('captureSelection'))
      assert.equal(captured.text, selection.selectedText)
      // Retain the range through the original SelectionMonitor debounce. An
      // immediate capture alone cannot prove that application controls receive it.
      await new Promise(resolve => setTimeout(resolve, 350))
      const selected = messages.map(message => parseReaderMessage(JSON.stringify(message), 'fixture')).findLast(event => event?.type === 'textSelected')
      assert.equal(selected?.text, selection.selectedText, 'The unchanged monitor must publish the actual selected range')
      const count = messages.filter(message => message.payload.type === 'textSelected').length
      const observation = execute('prepareFixture', {kind: 'inspect-selection'})
      assert.equal(observation.monitoring, true)
      assert.equal(observation.rangeInsideMonitor, true)
      assert.equal(observation.lastSelectionTextLength, selection.selectedText.length)
      assert.equal(messages.filter(message => message.payload.type === 'textSelected').length, count, 'Read-only diagnosis cannot synthesize a selection event')
      const markId = sourceStableId(bundle.ids.comment)
      assert.equal(window.document.querySelector(`slax-mark[data-uuid="${markId}"]`), null, 'DOM range identity is independent of the persisted comment ID')
      execute('prepareFixture', {kind: 'open-comment', markId})
      const click = messages.map(message => parseReaderMessage(JSON.stringify(message), 'fixture')).findLast(event => event?.type === 'markClicked')
      assert.ok(click?.mark.comments.some(comment => comment.markId === markId))
      assert.equal(click.mark.comments.find(comment => comment.markId === markId).children[0].comment, 'Reply to the fixed comment.')
      execute('prepareFixture', prepared.actions.find(action => action.kind === 'open-image'))
      const image = messages.map(message => parseReaderMessage(JSON.stringify(message), 'fixture')).findLast(event => event?.type === 'imageClick')
      assert.equal(image.src, 'slaxstatics://fixture-images.test/success.png')
      assert.equal(image.index, 0)
      assert.deepEqual(image.allImages, ['slaxstatics://fixture-images.test/success.png', 'slaxstatics://fixture-images.test/failure.png'])
    } finally {await close()}
  })
}
test('shared native reader documents retain source wrappers, anchor targets and canonical YouTube cues', options, async () => {
  for (const name of ['mixed', 'long', 'video', 'rss', 'short']) {
    const content = await readFile(new URL(`../../fixtures/articles/${name}.html`, import.meta.url), 'utf8')
    const {window, close} = await fixture('android', content)
    try {
      assert.ok(window.document.querySelector('body > div > article'), `${name} stays an article fragment inside the original source wrapper`)
      assert.ok(window.SlaxWebViewBridge.markManager)
      if (name === 'mixed') {
        assert.equal(window.document.querySelector('#escaped-quote').textContent, 'The quote says `hello` and ${value}.')
        assert.ok(window.document.querySelector('#outline'))
        assert.ok(window.document.querySelector('#last-heading'))
      } else if (name === 'long') {
        assert.ok(window.document.querySelector('#paragraph-40'))
        assert.equal(window.document.querySelectorAll('#long-fixture > p').length, 80)
      } else if (name === 'video') {
        const player = window.document.querySelector('.slax-yt > youtube-player[data-cues]')
        assert.equal(player?.dataset.videoId, 'abcdefghijk')
        const cues = youtubeCues(content)
        assert.deepEqual(cues.map(cue => cue.t), [0, 42, 84])
        assert.deepEqual([...window.document.querySelectorAll('.slax-yt-transcript [data-yt-seek]')].map(cue => Number(cue.dataset.ytSeek)), cues.map(cue => cue.t))
        assert.deepEqual([...window.document.querySelectorAll('.slax-yt-cue-text')].map(cue => cue.textContent), cues.map(cue => cue.text))
      } else if (name === 'rss') {
        assert.equal(window.document.querySelector('img').getAttribute('src'), 'slaxstatics://fixture-images.test/rss.png?m=rss&d=fixture-only')
      }
    } finally {await close()}
  }
})
test('shared native legal documents remain complete local pages', options, async () => {
  const {Window} = await import(pathToFileURL(domModule).href)
  for (const name of ['terms', 'privacy', 'delete-notice']) {
    const content = await readFile(new URL(`../../fixtures/articles/${name}.html`, import.meta.url), 'utf8')
    const window = new Window({settings: {disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true}})
    try {
      window.document.write(content)
      assert.equal(window.document.querySelectorAll('html').length, 1)
      assert.ok(window.document.querySelector('head meta[name="viewport"]'))
      assert.ok(window.document.querySelector('body > h1'))
      if (name === 'delete-notice') assert.equal(window.document.querySelector('#notice-end').textContent, 'End of notice')
    } finally {await window.happyDOM.close()}
  }
})
test('share image query retains DOM order and decoded image URLs, excluding embedded data images', options, async () => {
  const {execute, close} = await fixture('ios', '<p>&lt;img src="https://invalid/text.png"&gt;</p><img src="data:image/png;base64,AA"><img src="https://images.invalid/first.png?a=1&amp;b=2"><img src="https://images.invalid/second.png"><img src="https://images.invalid/third.png">')
  try {assert.deepEqual(execute('queryImageUrls'), ['slaxstatics://images.invalid/first.png?a=1&b=2', 'slaxstatics://images.invalid/second.png', 'slaxstatics://images.invalid/third.png'])}
  finally {await close()}
})

test('source YouTube cue commands seek/play and read current time without replacing the article', options, async () => {
  const content = '<p id="kept-content">Keep reading state</p><youtube-player><div class="slax-yt"><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe></div></youtube-player><span id="cue" data-yt-seek="42">00:42</span>'
  let seconds = 0
  let plays = 0
  const { window, messages, execute, close } = await fixture('android', content, window => {
    // Fake only the third-party iframe provider. All source template functions remain unchanged.
    window.YT = { Player: function(_element, config) {
      this.seekTo = value => { seconds = value }
      this.playVideo = () => { plays++ }
      this.getCurrentTime = () => seconds
      window.queueMicrotask(() => config.events.onReady())
    } }
  })
  try {
    await Promise.resolve()
    const element = window.document.querySelector('#kept-content')
    execute('seekYoutube', 18)
    assert.equal(execute('queryYoutubeTime'), 18)
    window.document.querySelector('#cue').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    assert.equal(execute('queryYoutubeTime'), 42)
    assert.equal(plays, 2)
    assert.ok(messages.some(message => message.payload.type === 'scrollToTop'))
    assert.equal(window.document.querySelector('#kept-content'), element)
  } finally { await close() }
})

test('source outline anchors remain programmatic selections without opening annotation controls', options, async () => {
  const { window, messages, execute, close } = await fixture('android', article, window => {
    // Source recognizes jsdom as a DOM-only runtime and skips its native visibility check.
    Object.defineProperty(window.navigator, 'userAgent', { value: 'jsdom fixture' })
    // Happy DOM omits NodeIterator's referenceNode/pointerBeforeReferenceNode. Model the
    // standard text-node cursor contract; this fixture does not measure native layout.
    window.document.createNodeIterator = root => {
      const walker = window.document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT)
      const nodes = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node)
      let index = -1
      const iterator = { whatToShow: window.NodeFilter.SHOW_TEXT, referenceNode: root, pointerBeforeReferenceNode: true,
        nextNode() {
          const next = this.pointerBeforeReferenceNode && index >= 0 ? index : index + 1
          if (!nodes[next]) return null
          index = next; this.referenceNode = nodes[index]; this.pointerBeforeReferenceNode = false
          return nodes[index]
        },
        previousNode() {
          const previous = this.pointerBeforeReferenceNode ? index - 1 : index
          if (!nodes[previous]) return null
          index = previous; this.referenceNode = nodes[index]; this.pointerBeforeReferenceNode = true
          return nodes[index]
        },
      }
      return iterator
    }
  })
  try {
    assert.equal(execute('scrollToAnchor', 'A stable outline heading'), true)
    window.SlaxWebViewBridge.selectionMonitor.processSelection()
    assert.equal(messages.filter(message => message.payload.type === 'textSelected').length, 0)
  } finally { await close() }
})
