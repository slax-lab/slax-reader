import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {React, act, nativeBoundary, loadComponent, withNativeHost, flattenStyle} from '../reader/parity-host.mjs'
import {mobileColors, mobileLayout, mobileTypography} from '../../src/theme/index.ts'
import {SessionController} from '../../src/domain/session.ts'
import {PreferenceStore} from '../../src/data/preferences.ts'
import {FixtureMemoryPreferences} from '../../fixtures/isolation.ts'

const text = node => Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : node ?? ''
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no}); return {promise, resolve, reject}}
async function loginFixture(host, platform, run, props = {}) {
  let marks = 0;
  const markInteractive = () => {marks++;};
  const controls = new Map(), providers = [], requests = [], accepted = [], alerts = [], lifecycle = []
  const png = readFileSync(new URL('../../assets/drawable/bg_login.png', import.meta.url))
  const background = {uri: 'bundled:bg_login', width: png.readUInt32BE(16), height: png.readUInt32BE(20)}
  let artwork, viewport = {width: 390, height: 844}
  const Image = props => {
    if (props.source === background) artwork = {...props, resolvedStyle: {...background, ...flattenStyle(props.style)}}
    return React.createElement(host.native.Image, props)
  }
  let modal, phase = 'hidden', session = {status: 'unauthenticated'}, authenticate = async provider => ({provider})
  const primitive = props => {if (props.onPress) controls.set(props.accessibilityLabel ?? text(props.children), props); return React.createElement(host.native.View, props)}
  const Modal = props => {
    React.useLayoutEffect(() => {if (props.visible) {phase = 'presented'; lifecycle.push(phase)} else if (phase === 'presented') {phase = 'dismissing'; lifecycle.push(phase)}}, [props.visible])
    modal = {...props, onDismiss() {phase = 'dismissed'; lifecycle.push(phase); props.onDismiss()}}
    return props.visible ? React.createElement(host.native.View, props) : null
  }
  let identity = 0
  let loginResponse = {token: 'synthetic', user_id: 'fixture'}
  const mobile = {api: {login: async request => {requests.push(request); return loginResponse}}, sessions: {getSnapshot: () => session, captureIdentity: () => {const before = identity; return () => {if (before !== identity) throw new Error('Identity changed')}}, accept: async (...values) => accepted.push(values)}, t: key => key, config: {webUrl: 'https://fixture.test'}}
  const {LoginScreen} = await loadComponent('../../src/screens/LoginScreen.tsx', {
    react: React, 'react-native': {...host.native, Platform: {OS: platform}, useWindowDimensions: () => viewport, Image, Text: primitive, Pressable: primitive, Modal, Alert: {alert: (...args) => alerts.push(args)}},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})}, 'react-native-webview': {WebView: () => null}, '../../assets': {mobileAssets: {bg_login: background}},
    '../auth/providers': {authenticate: provider => {providers.push({provider, phase}); return authenticate(provider)}}, '../runtime': {useMobile: () => mobile},
    '../theme': {mobileColors, mobileLayout, mobileTypography}, '../theme/testIds': {mobileTestIds: {}}, '../telemetry': {useTelemetry: () => ({element() {}, firebase() {}})}, '../native/fixture-document': {}, '../components/fixture-actions': {},
    '../observe': {useObserveMarkInteractive: () => markInteractive},
  }, {Error})
  const render = () => host.render(React.createElement(LoginScreen, props))
  const press = key => act(async () => controls.get(key).onPress())
  await render()
  await run({render, press, modal: () => modal, controls, providers, requests, accepted, alerts, lifecycle, marks: () => marks, useSessions: value => {mobile.sessions = value}, response: value => {loginResponse = value},
    artwork: () => artwork, resize: async width => {viewport = {...viewport, width}; await render()},
    hydrate: () => {session = {status: 'unauthenticated'}},
    replaceIdentity: () => {identity++; session = {status: 'unauthenticated'}},
    setUser: () => {identity++; session = {status: 'authenticated', session: {userId: 'other', token: 'replacement'}}}, authenticate: value => {authenticate = value}})
}

for (const platform of ['ios', 'android']) test(`mounted ${platform} login artwork overrides intrinsic PNG dimensions and follows the source layout ratio`, nativeBoundary, async () => withNativeHost(async host => loginFixture(host, platform, async fixture => {
  assert.equal(fixture.artwork().source.width, 1500); assert.equal(fixture.artwork().source.height, 1260)
  for (const width of [320, 375, 390, 430, 844]) {
    await fixture.resize(width)
    const artwork = fixture.artwork(), style = flattenStyle(artwork.style)
    assert.equal(style.width, width)
    assert.ok(Math.abs(style.height - width * 314 / 375) < 1e-9, 'The bundled PNG height must not leak into logical layout')
    assert.equal(artwork.resolvedStyle.height, style.height)
    assert.equal(artwork.resizeMode, 'contain')
  }
})))

test('mounted login marks interactive once after first render', nativeBoundary, async () => withNativeHost(async host => loginFixture(host, 'ios', async fixture => {
  assert.equal(fixture.marks(), 1);
  await fixture.render();
  assert.equal(fixture.marks(), 1);
})));

for (const platform of ['ios', 'android']) test(`mounted ${platform} Google agreement continues only at its platform dismissal boundary`, nativeBoundary, async () => withNativeHost(async host => loginFixture(host, platform, async fixture => {
  await fixture.press('login_google')
  await fixture.press('agreement_btn_agree')
  assert.equal(fixture.modal().visible, false)
  if (platform === 'ios') {assert.deepEqual(fixture.providers, []); await fixture.render(); assert.deepEqual(fixture.providers, [])}
  const modal = fixture.modal()
  await act(async () => {modal.onDismiss(); modal.onDismiss()})
  assert.deepEqual(fixture.providers, [{provider: 'google', phase: platform === 'ios' ? 'dismissed' : 'presented'}])
  assert.equal(fixture.requests.length, 1); assert.equal(fixture.accepted.length, 1)
})))

for (const cancel of ['disagree', 'request-close', 'unmount', 'account']) test(`mounted iOS agreement drops pending provider on ${cancel}`, nativeBoundary, async () => withNativeHost(async host => loginFixture(host, 'ios', async fixture => {
  await fixture.press('login_google')
  const open = fixture.modal()
  await fixture.press('agreement_btn_agree')
  if (cancel === 'disagree') await fixture.press('agreement_btn_disagree')
  else if (cancel === 'request-close') await act(async () => open.onRequestClose())
  else if (cancel === 'unmount') await host.unmount()
  else fixture.setUser()
  await act(async () => {open.onDismiss(); fixture.modal().onDismiss()})
  assert.deepEqual(fixture.providers, []); assert.deepEqual(fixture.accepted, [])
})))

test('retired iOS agreement cannot start replacement provider and provider rejection is safely reported after dismissal', nativeBoundary, async () => withNativeHost(async host => loginFixture(host, 'ios', async fixture => {
  await fixture.press('login_google'); const retired = fixture.modal()
  await act(async () => retired.onRequestClose())
  await fixture.press('login_apple'); await fixture.press('agreement_btn_agree')
  await act(async () => retired.onDismiss()); assert.deepEqual(fixture.providers, [])
  fixture.authenticate(async () => {throw new Error('Synthetic provider failure')})
  await act(async () => fixture.modal().onDismiss())
  assert.deepEqual(fixture.providers, [{provider: 'apple', phase: 'dismissed'}])
  assert.equal(fixture.alerts.length, 1); assert.deepEqual(fixture.accepted, [])
})))

for (const cancel of ['unmount', 'account', 'identity']) test(`provider completion after ${cancel} cannot accept a session`, nativeBoundary, async () => withNativeHost(async host => loginFixture(host, 'ios', async fixture => {
  const gate = deferred(); fixture.authenticate(() => gate.promise)
  await fixture.press('login_google'); await fixture.press('agreement_btn_agree'); await act(async () => fixture.modal().onDismiss())
  if (cancel === 'unmount') await host.unmount(); else if (cancel === 'identity') fixture.replaceIdentity(); else fixture.setUser()
  await act(async () => gate.resolve({provider: 'google'}))
  assert.deepEqual(fixture.requests, []); assert.deepEqual(fixture.accepted, []); assert.deepEqual(fixture.alerts, [])
})))

for (const platform of ['ios', 'android']) test(`mounted ${platform} native provider survives same-identity unauthenticated DB hydration`, nativeBoundary, async () => withNativeHost(async host => loginFixture(host, platform, async fixture => {
  const gate = deferred(); fixture.authenticate(() => gate.promise)
  await fixture.press('login_google'); await fixture.press('agreement_btn_agree')
  if (platform === 'ios') {
    fixture.hydrate(); await fixture.render()
    await act(async () => fixture.modal().onDismiss())
  }
  assert.equal(fixture.providers.length, 1)
  fixture.hydrate(); await fixture.render()
  await act(async () => gate.resolve({provider: 'google'}))
  assert.equal(fixture.requests.length, 1); assert.equal(fixture.accepted.length, 1); assert.deepEqual(fixture.alerts, [])
})))

for (const platform of ['ios', 'android']) test(`mounted ${platform} provider completes across real SessionController DB restore`, nativeBoundary, async () => withNativeHost(async host => loginFixture(host, platform, async fixture => {
  const gate = deferred(), database = deferred()
  const sessions = new SessionController(new PreferenceStore(new FixtureMemoryPreferences({})), {leave: () => database.promise, enter: async () => {}}, () => 123)
  await sessions.restoreLocal(); fixture.useSessions(sessions); await fixture.render()
  const identity = sessions.captureIdentity()
  fixture.authenticate(() => gate.promise)
  await fixture.press('login_google'); await fixture.press('agreement_btn_agree')
  if (platform === 'ios') await act(async () => fixture.modal().onDismiss())
  const restoring = sessions.restore()
  await act(async () => {database.resolve(); await restoring})
  assert.equal(sessions.getSnapshot().status, 'unauthenticated'); assert.doesNotThrow(identity)
  await fixture.render(); await act(async () => gate.resolve({provider: 'google'}))
  assert.equal(fixture.requests.length, 1); assert.equal(sessions.getSnapshot().status, 'authenticated'); assert.equal(sessions.getSnapshot().session.userId, 'fixture'); assert.deepEqual(fixture.alerts, [])
})))

for (const platform of ['ios', 'android']) test(`mounted ${platform} login reports session persistence failure and permits retry`, nativeBoundary, async () => withNativeHost(async host => loginFixture(host, platform, async fixture => {
  const storage = new FixtureMemoryPreferences({}), swap = storage.compareAndSwap.bind(storage)
  let fail = true
  storage.compareAndSwap = async (...args) => {if (fail) throw new Error('Synthetic preference write failed'); return swap(...args)}
  const sessions = new SessionController(new PreferenceStore(storage), {leave: async () => {}, enter: async () => {}}, () => 123)
  await sessions.restoreLocal(); fixture.useSessions(sessions); await fixture.render()
  await fixture.press('login_google'); await fixture.press('agreement_btn_agree')
  if (platform === 'ios') await act(async () => fixture.modal().onDismiss())
  assert.equal(fixture.requests.length, 1)
  assert.equal(sessions.getSnapshot().status, 'unauthenticated')
  assert.equal(fixture.alerts.length, 1)
  assert.match(fixture.alerts[0][1], /preference write failed/)
  fail = false
  await fixture.press('login_google')
  assert.equal(sessions.getSnapshot().status, 'authenticated')
  assert.equal(fixture.requests.length, 2)
})))

for (const retired of ['unmount', 'identity']) test(`session persistence failure after ${retired} cannot alert the replacement screen`, nativeBoundary, async () => withNativeHost(async host => loginFixture(host, 'ios', async fixture => {
  const storage = new FixtureMemoryPreferences({}), writing = deferred()
  let started = false
  storage.compareAndSwap = async () => {started = true; await writing.promise; throw new Error('Retired write failure')}
  const sessions = new SessionController(new PreferenceStore(storage), {leave: async () => {}, enter: async () => {}}, () => 123)
  await sessions.restoreLocal(); fixture.useSessions(sessions); await fixture.render()
  await fixture.press('login_google'); await fixture.press('agreement_btn_agree')
  await act(async () => fixture.modal().onDismiss()); assert(started)
  if (retired === 'unmount') await host.unmount(); else sessions.releaseLocalOwner()
  await act(async () => writing.resolve())
  assert.deepEqual(fixture.alerts, [])
})))
