import test from 'node:test'
import assert from 'node:assert/strict'
import {React, act, nativeBoundary, loadComponent, withNativeHost} from '../reader/parity-host.mjs'
import {mobileColors, mobileLayout, mobileTypography} from '../../src/theme/index.ts'

const text = node => Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : node ?? ''
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no}); return {promise, resolve, reject}}
async function loginFixture(host, platform, run) {
  const controls = new Map(), providers = [], requests = [], accepted = [], alerts = [], lifecycle = []
  let modal, phase = 'hidden', session = {status: 'unauthenticated'}, authenticate = async provider => ({provider})
  const primitive = props => {if (props.onPress) controls.set(props.accessibilityLabel ?? text(props.children), props); return React.createElement(host.native.View, props)}
  const Modal = props => {
    React.useLayoutEffect(() => {if (props.visible) {phase = 'presented'; lifecycle.push(phase)} else if (phase === 'presented') {phase = 'dismissing'; lifecycle.push(phase)}}, [props.visible])
    modal = {...props, onDismiss() {phase = 'dismissed'; lifecycle.push(phase); props.onDismiss()}}
    return props.visible ? React.createElement(host.native.View, props) : null
  }
  const mobile = {api: {login: async request => {requests.push(request); return {token: 'synthetic', user_id: 'fixture'}}}, sessions: {getSnapshot: () => session, accept: async (...values) => accepted.push(values)}, t: key => key, config: {webUrl: 'https://fixture.test'}}
  const {LoginScreen} = await loadComponent('../../src/screens/LoginScreen.tsx', {
    react: React, 'react-native': {...host.native, Platform: {OS: platform}, Text: primitive, Pressable: primitive, Modal, Alert: {alert: (...args) => alerts.push(args)}},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})}, 'react-native-webview': {WebView: () => null}, '../../assets': {mobileAssets: {}},
    '../auth/providers': {authenticate: provider => {providers.push({provider, phase}); return authenticate(provider)}}, '../runtime': {useMobile: () => mobile},
    '../theme': {mobileColors, mobileLayout, mobileTypography}, '../theme/testIds': {mobileTestIds: {}}, '../telemetry': {useTelemetry: () => ({element() {}, firebase() {}})}, '../native/fixture-document': {}, '../components/fixture-actions': {},
  })
  const render = () => host.render(React.createElement(LoginScreen))
  const press = key => act(async () => controls.get(key).onPress())
  await render()
  await run({render, press, modal: () => modal, controls, providers, requests, accepted, alerts, lifecycle, setUser: () => {session = {status: 'authenticated', session: {userId: 'other'}}}, authenticate: value => {authenticate = value}})
}

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

for (const cancel of ['unmount', 'account']) test(`provider completion after ${cancel} cannot accept a session`, nativeBoundary, async () => withNativeHost(async host => loginFixture(host, 'ios', async fixture => {
  const gate = deferred(); fixture.authenticate(() => gate.promise)
  await fixture.press('login_google'); await fixture.press('agreement_btn_agree'); await act(async () => fixture.modal().onDismiss())
  if (cancel === 'unmount') await host.unmount(); else fixture.setUser()
  await act(async () => gate.resolve({provider: 'google'}))
  assert.deepEqual(fixture.requests, []); assert.deepEqual(fixture.accepted, []); assert.deepEqual(fixture.alerts, [])
})))
