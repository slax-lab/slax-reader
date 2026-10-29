import test from 'node:test'
import assert from 'node:assert/strict'
import {refreshSelectedMark, sourceDisplayTime, subscriptionActive} from '../../src/reader/model.ts'
import * as model from '../../src/reader/model.ts'
import * as motion from '../../src/reader/outline-motion.ts'
import * as coordinates from '../../src/reader/coordinates.ts'
import {isCustomGalleryImage} from '../../src/reader/gallery-resource.ts'
import {mobileColors, mobileTypography} from '../../src/theme/index.ts'
import {React, act, nativeBoundary, loadComponent, withNativeHost, flattenStyle} from './parity-host.mjs'

const source = [{type: 'text', path: '/p/text()', start: 2, end: 12}]
const approx = {exact: 'quoted text', prefix: 'before', suffix: 'after', position_start: 2, position_end: 12}
const fresh = () => ({id: '', source, approx, stroke: [], comments: []})
const comment = (markId = 1, extra = {}) => ({markId, userId: 1, comment: `Body ${markId}`, username: 'Fixture', avatar: '', createdAt: '2026-10-11 12:00:00', isDeleted: false, children: [], ...extra})

test('complete redraw preserves existing IDs and reconciles removed or recreated ranges without stale annotations', () => {
  const initial = fresh(), first = {...fresh(), id: 'new-uuid', comments: [comment()], stroke: [{userId: 1}]}
  assert.equal(refreshSelectedMark(initial, [first]), first)
  const recreated = {...first, id: 'another-id', comments: [comment(3)]}
  assert.equal(refreshSelectedMark(first, [recreated]), recreated)
  const updated = {...first, source: [{...source[0], path: '/relocated/text()'}], comments: [comment(), comment(2)]}
  assert.equal(refreshSelectedMark(first, [recreated, updated]), updated, 'An existing ID takes precedence over same-range fallback')
  const removed = refreshSelectedMark(first, [])
  assert.deepEqual(removed, initial, 'A complete redraw with no group clears deleted comments, strokes and identity')
  assert.equal(removed.source, first.source)
  assert.equal(removed.approx, first.approx)
  assert.equal(refreshSelectedMark(removed, [recreated]), recreated)
  const unrelated = {...recreated, source: [{...source[0], end: 14}], approx: {...approx, position_end: 14}}
  assert.deepEqual(refreshSelectedMark(first, [unrelated]), initial, 'A different range cannot retain or replace a removed group')
  assert.deepEqual(first.comments, [comment()], 'Reconciliation never mutates the prior group')
  assert.deepEqual(initial, fresh(), 'Matching never mutates the captured source')
})

test('selection matching rejects different offsets, absent context and ambiguous ranges', () => {
  const initial = fresh(), mismatch = {...fresh(), id: 'wrong', source: [{...source[0], end: 14}], approx: {...approx, position_end: 14}}
  assert.equal(refreshSelectedMark(initial, [mismatch]), initial)
  const absent = {...fresh(), source: [], approx: null}
  assert.equal(refreshSelectedMark(absent, [{...absent, id: 'wrong'}]), absent)
  assert.equal(refreshSelectedMark(initial, [{...fresh(), id: 'one'}, {...fresh(), id: 'two'}]), initial)
  const historical = {...fresh(), source: []}, restored = {...fresh(), id: 'context-uuid'}
  assert.equal(refreshSelectedMark(historical, [restored]), restored)
  const relocated = {...restored, source: [{...source[0], path: '/new-container/p/text()'}]}
  assert.equal(refreshSelectedMark(initial, [relocated]), relocated)
  assert.equal(refreshSelectedMark(initial, [{...restored, source: [{...source[0], end: 14}]}]), initial, 'Conflicting same-path offsets cannot be repaired by equal text')
  const textOnly = {...fresh(), source: [], approx: {exact: 'repeated'}}
  assert.equal(refreshSelectedMark(textOnly, [{...textOnly, id: 'wrong'}]), textOnly)
})

test('Reader display/subscription treat offsetless source timestamps as UTC without replacing explicit offsets', () => {
  const previous = process.env.TZ
  process.env.TZ = 'Asia/Shanghai'
  try {
    assert.equal(sourceDisplayTime('2026-10-11 12:00:00'), '2026-10-11 20:00')
    assert.equal(sourceDisplayTime('2026-10-11T12:00:00+08:00'), '2026-10-11 12:00')
    assert.equal(sourceDisplayTime('invalid'), '')
    assert.equal(subscriptionActive([{subscription_end_time: '2026-10-11 12:00:00'}], Date.parse('2026-10-11T11:59:59Z')), true)
    assert.equal(subscriptionActive([{subscription_end_time: '2026-10-11T12:00:00+08:00'}], Date.parse('2026-10-11T11:59:59Z')), false)
  } finally {if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous}
})

async function overlays(host, motionHost) {
  return loadComponent('../../src/reader/ReaderOverlays.tsx', {
    ...(motionHost ? {'react-native-reanimated': motionHost.reanimated} : {}),
    react: React, 'react-native': host.native, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '../components': host.components, '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model,
    './MarkdownView.tsx': {MarkdownView: props => React.createElement(host.native.View, {...props, testID: 'markdown'})}, './outline-motion.ts': motion,
  })
}

test('actual comments and replies expose Copy without delete permission, then delegate Delete to confirmation', nativeBoundary, async () => withNativeHost(async host => {
  const {CommentPanel} = await overlays(host), copied = [], deleted = [], replied = []
  const child = comment(2), parent = comment(1, {children: [child]}), removed = comment(3, {isDeleted: true})
  let menu = null, allowDelete = false
  const props = {visible: true, mark: {...fresh(), comments: [parent, removed]}, text: 'Quote\n\nsecond\nthird', draft: 'Keep this draft', reply: null, currentUserAvatar: '', hideProfiles: false, allowLine: true, allowComment: true, autoFocus: false, busy: false,
    t: key => key, onDraft() {}, onClose() {}, onCopy() {copied.push('quote')}, onCopyComment: value => copied.push(value.comment), onHighlight() {}, onReply: value => replied.push(value), onDelete: value => deleted.push(value), canDelete: () => allowDelete, onSubmit() {}}
  const render = async () => host.render(React.createElement(CommentPanel, {...props, menu, onMenu: value => {menu = value}}))
  await render()
  assert.equal(flattenStyle(host.props.get('reader-comment-panel').style).maxHeight, '80%')
  assert.equal(flattenStyle(host.props.get('reader-comment-panel').style).height, undefined)
  assert.equal(host.props.get('reader-comment-quote').numberOfLines, 2)
  assert.equal(host.props.get('reader-comment-quote').children, 'Quote\nsecond\nthird')
  assert.equal(host.props.get('reader-comment-input').maxLength, 1500)
  for (const id of [1, 2]) {
    await act(async () => host.props.get(`reader-comment-${id}`).onLongPress({nativeEvent: {pageX: 380, pageY: 400, locationY: 20}}))
    await render()
    assert.ok(host.props.get('reader-comment-copy'))
    assert.equal(host.props.get('reader-comment-delete'), undefined)
    assert.equal(host.props.get('reader-comment-list').scrollEnabled, false)
    await act(async () => host.props.get('reader-comment-copy').onPress())
    await render()
    assert.equal(host.props.get('reader-comment-input').value, 'Keep this draft')
  }
  assert.deepEqual(copied, ['Body 1', 'Body 2'])
  assert.deepEqual(deleted, [])
  await act(async () => host.props.get('reader-comment-3').onLongPress({nativeEvent: {}})); await render()
  assert.equal(menu, null)
  allowDelete = true
  await act(async () => host.props.get('reader-comment-2').onLongPress({nativeEvent: {pageX: 200, pageY: 400, locationY: 0}})); await render()
  assert.deepEqual(deleted, [], 'Long press must never perform deletion')
  await act(async () => host.props.get('reader-comment-delete').onPress()); await render()
  assert.deepEqual(deleted, [child], 'The menu delegates to the existing parent confirmation')
  await act(async () => host.props.get('reader-comment-2').onPress())
  assert.deepEqual(replied, [child]); assert.equal(host.focused(), 1)
  await act(async () => host.keyboard.get('keyboardWillShow')()); await render()
  assert.equal(flattenStyle(host.props.get('reader-comment-panel').style).paddingBottom, 8)
  await act(async () => host.props.get('reader-comment-list').onScrollBeginDrag())
  assert.equal(host.dismisses(), 1)
}))

test('actual outline keeps source footer actions, native-safe transient states and expansion/minimize motion', nativeBoundary, async () => withNativeHost(async host => {
  const {installedMotionHost} = await import('../ui/installed-motion-host.mjs')
  const ui = installedMotionHost(host.native.View)
  const {OutlineSheet} = await overlays(host, ui)
  const settle = async () => {await act(async () => {for (let time = 0; time < 700; time += 16) ui.advance(16)}); await render()}
  let status = 'collapsed', closed = 0, minimized = 0
  const render = () => host.render(React.createElement(OutlineSheet, {status, toolbarVisible: true, markdown: 'Outline', pending: false, busy: false, error: null, position: 120, t: key => key,
    onClose() {closed++; status = 'hidden'}, onCollapse() {minimized++; status = 'collapsed'}, onExpand() {status = 'expanded'}, onRetry() {}, onLink() {}, onPosition() {}}))
  await render()
  assert.equal(host.props.get('reader-outline-panel').pointerEvents, 'none')
  await act(async () => host.props.get('reader-outline-expand').onPress()); await render()
  assert.equal(host.props.get('reader-outline-panel').pointerEvents, 'auto')
  assert.equal(flattenStyle(host.props.get('reader-outline-panel').style).height, 746)
  assert.equal(flattenStyle(host.props.get('reader-outline-footer').style).height, 55)
  assert.equal(host.props.get('markdown'), undefined, 'Outline content waits for the expansion to settle')
  await settle()
  assert.ok(host.props.get('markdown'))
  assert.deepEqual(motion.outlineMotion('collapsed', 'expanded').morph, [{toValue: 1, duration: 380, delay: 80}])
  await act(async () => host.props.get('reader-outline-minimize').onPress()); await render()
  assert.equal(minimized, 1); assert.equal(closed, 0)
  assert.equal(host.props.get('reader-outline-panel').pointerEvents, 'none')
  assert.deepEqual(motion.outlineMotion('expanded', 'collapsed').morph, [{toValue: 0, duration: 380, delay: 100}])
  assert.deepEqual(motion.outlineMotion('expanded', 'collapsed').collapsed, [{toValue: 1, duration: 150, delay: 430}])
  await act(async () => host.props.get('reader-outline-expand').onPress()); await render()
  await act(async () => host.props.get('reader-outline-close').onPress()); await render()
  assert.equal(closed, 1); assert.equal(status, 'hidden')
  assert.equal(host.props.get('reader-outline-panel').accessibilityElementsHidden, true)
}))

test('actual gallery resets old zoom only after a committed page, not cancelled edge gestures', nativeBoundary, async () => withNativeHost(async host => {
  const {installedMotionHost} = await import('../ui/installed-motion-host.mjs')
  const motion = installedMotionHost(host.native.View)
  const {ImageGallery} = await loadComponent('../../src/reader/ImageGallery.tsx', {
    react: React, 'react-native': host.native, 'react-native-reanimated': motion.reanimated, 'react-native-gesture-handler': motion.gestures,
    '../components': host.components, '../components/AppImage': {AppImage: props => props.children ?? null}, './gallery-resource': {isCustomGalleryImage},
  })
  const gesture = name => motion.detectors().flatMap(value => value.toGestureArray()).find(value => value.handlerName === name && value.config.enabled)
  const snapshot = () => motion.values.map(value => value.value)
  const changed = before => motion.values.slice(0, before.length).filter((value, index) => value.value !== before[index])
  const count = () => /(\d+ \/ \d+)/.exec(host.window.document.body.textContent)?.[1]
  const press = async action => act(async () => action())
  const pinch = async scale => press(() => {const event = {scale, focalX: 195, focalY: 400}
    gesture('PinchGestureHandler').handlers.onStart(event); gesture('PinchGestureHandler').handlers.onUpdate(event); gesture('PinchGestureHandler').handlers.onFinalize(event, true)})
  const drag = async (translationX, velocityX = 0, reserve) => {
    const before = snapshot()
    const event = {translationX, translationY: 0, velocityX, numberOfPointers: 1}
    await press(() => {gesture('PanGestureHandler').handlers.onStart(event); gesture('PanGestureHandler').handlers.onUpdate(event)})
    const offset = reserve === undefined ? undefined : changed(before).find(value => value.value === reserve)
    if (reserve !== undefined) assert.equal(offset?.value, reserve, `A drag of ${translationX} reserves a page offset of ${reserve}`)
    await press(() => {gesture('PanGestureHandler').handlers.onEnd(event, true); gesture('PanGestureHandler').handlers.onFinalize(event, true)
      for (let frame = 0; frame < 200 && motion.pending(); frame++) motion.advance(16)})
    return offset
  }
  await host.render(React.createElement(ImageGallery, {images: ['https://fixture.test/a', 'https://fixture.test/b'], index: 0, resolveUri: async uri => `file:///fixture/${uri.endsWith('/a') ? 'a' : 'b'}.png`, onDismiss() {}, errorLabel: 'error'}))
  assert.equal(count(), '1 / 2')
  const resting = snapshot(); await pinch(3)
  const zoom = changed(resting).filter(value => value.value === 3)
  assert.equal(zoom.length, 1, 'Only the active page zoom records the pinch scale')
  await drag(-390)
  assert.equal(zoom[0].value, 3)
  const reserved = await drag(-30, 0, 30)
  assert.equal(reserved.value, 0, 'An uncommitted edge swipe returns the strip to its page')
  assert.equal(zoom[0].value, 3, 'An uncommitted edge swipe retains zoom')
  assert.equal(count(), '1 / 2')
  const committed = await drag(-100, 0, 100)
  assert.equal(count(), '2 / 2')
  assert.equal(committed.value, 390, 'The absolute strip rests on the committed page')
  assert.equal(zoom[0].value, 1, 'The retired page resets its zoom once it commits a replacement')
  const returned = await drag(100, 0, 290)
  assert.equal(count(), '1 / 2')
  assert.equal(returned.value, 0)
  assert.equal(zoom[0].value, 1, 'Returning to a retired page starts fitted')
}))
