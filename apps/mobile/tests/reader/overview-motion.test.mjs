import test from 'node:test'
import assert from 'node:assert/strict'
import {React, act, nativeBoundary, loadComponent, withNativeHost, flattenStyle} from './parity-host.mjs'
import {installedMotionHost} from '../ui/installed-motion-host.mjs'

const reduced = native => ({...native, AccessibilityInfo: {isReduceMotionEnabled: async () => true, addEventListener: () => ({remove() {}})}})
const frames = async (ui, duration) => act(async () => {for (let time = 0; time < duration; time += 16) ui.advance(16)})

async function overviewViews(host, options = {}) {
  const ui = installedMotionHost(host.native.View, options)
  const module = await loadComponent('../../src/reader/OverviewViews.tsx', {
    react: React, 'react-native': options.reducedMotion ? reduced(host.native) : host.native, 'react-native-reanimated': ui.reanimated, '../components': host.components,
  })
  return {ui, ...module}
}
const dialogProps = {content: 'Summary', takeaways: ['One', 'Two'], title: 'overview_dialog_title', closeLabel: 'btn_close'}

test('overview dialog grows from the excerpt frame with the source 250 ms progress and 300 ms fade, then reverses before unmounting', nativeBoundary, async () => withNativeHost(async host => {
  const {ui, OverviewDialog} = await overviewViews(host)
  let closes = 0
  const source = {x: 20, y: 300, width: 350, height: 64}
  const render = visible => host.render(React.createElement(OverviewDialog, {...dialogProps, visible, sourceBounds: source, onClose: () => closes++}))
  await render(false)
  assert.equal(host.props.get('reader-overview-dialog'), undefined, 'A closed dialog renders nothing')
  await render(true)
  const card = () => flattenStyle(host.props.get('reader-overview-dialog').style)
  assert.deepEqual([card().left, card().top, card().width, card().height, card().opacity], [20, 300, 350, 64, 0], 'The first frame starts on the excerpt')
  await frames(ui, 128); await render(true)
  assert.ok(card().width > 350 - 1 && card().height > 64 && card().opacity > 0 && card().opacity < 1, 'Midway the card has grown and is fading in')
  await frames(ui, 300); await render(true)
  assert.deepEqual([card().left, card().width, card().opacity], [20, 350, 1])
  assert.equal(card().height, 844 * .8, 'Without measured contents the card targets 80% of the window')
  assert.equal(card().top, (844 - 844 * .8) / 2)
  assert.ok(host.props.get('reader-overview-close'))
  assert.equal(host.props.get('reader-overview-surface').pointerEvents, 'auto')
  await act(async () => host.props.get('reader-overview-close').onPress())
  assert.equal(closes, 1)
  await render(false)
  assert.ok(host.props.get('reader-overview-dialog'), 'Dismissal keeps the dialog mounted while it animates back')
  assert.equal(host.props.get('reader-overview-surface').pointerEvents, 'none', 'A dismissing dialog no longer captures touches')
  await frames(ui, 150); await render(false)
  assert.ok(card().width < 350 + 1 || card().opacity < 1)
  await frames(ui, 300); await render(false)
  assert.equal(host.props.get('reader-overview-dialog'), undefined, 'The dialog unmounts after its exit animation finishes')
  assert.equal(ui.pending(), 0)
}))

test('overview dialog reopened mid-exit reverses without unmounting, and grows from the window centre without an excerpt frame', nativeBoundary, async () => withNativeHost(async host => {
  const {ui, OverviewDialog} = await overviewViews(host)
  const render = visible => host.render(React.createElement(OverviewDialog, {...dialogProps, visible, onClose() {}}))
  await render(true); await frames(ui, 400); await render(false); await frames(ui, 100); await render(true); await frames(ui, 400); await render(true)
  assert.equal(flattenStyle(host.props.get('reader-overview-dialog').style).opacity, 1, 'A cancelled exit never unmounts a reopened dialog')
  const fallback = await overviewViews(host)
  await host.render(React.createElement(fallback.OverviewDialog, {...dialogProps, visible: true, onClose() {}}))
  const first = flattenStyle(host.props.get('reader-overview-dialog').style)
  assert.deepEqual([first.left, first.top, first.width, first.height], [195, 422, 0, 0], 'Without an excerpt frame the card grows from the window centre')
}))

test('reduced motion presents and removes the overview dialog without transition frames', nativeBoundary, async () => withNativeHost(async host => {
  const {ui, OverviewDialog} = await overviewViews(host, {reducedMotion: true})
  const render = visible => host.render(React.createElement(OverviewDialog, {...dialogProps, visible, onClose() {}}))
  await render(false); await host.settle()
  await render(true); await render(true)
  assert.equal(flattenStyle(host.props.get('reader-overview-dialog').style).opacity, 1)
  await render(false); await render(false)
  assert.equal(host.props.get('reader-overview-dialog'), undefined)
  assert.equal(ui.pending(), 0)
}))

test('overview excerpt reports its window frame from the press, and omits empty overviews', nativeBoundary, async () => withNativeHost(async host => {
  const {OverviewExcerpt} = await overviewViews(host)
  const pressed = []
  await host.render(React.createElement(OverviewExcerpt, {content: '', prefix: 'Overview: ', onPress: value => pressed.push(value)}))
  assert.equal(host.props.get('reader-overview-excerpt'), undefined)
  await host.render(React.createElement(OverviewExcerpt, {content: 'Summary', prefix: 'Overview: ', onPress: value => pressed.push(value)}))
  const excerpt = host.props.get('reader-overview-excerpt')
  excerpt.onLayout({nativeEvent: {layout: {x: 0, y: 0, width: 350, height: 64}}})
  await act(async () => excerpt.onPress({nativeEvent: {pageX: 120, pageY: 330, locationX: 100, locationY: 30}}))
  await act(async () => excerpt.onPress({nativeEvent: {}}))
  assert.equal(JSON.stringify(pressed), JSON.stringify([{x: 20, y: 300, width: 350, height: 64}, null]), 'An accessibility activation without coordinates falls back to the centred growth')
}))
