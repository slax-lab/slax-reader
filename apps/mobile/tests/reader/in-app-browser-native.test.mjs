import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
import {readFile} from 'node:fs/promises'

const platformSource = await readFile(new URL('../../src/native/platform.ts', import.meta.url), 'utf8')
const readerSource = await readFile(new URL('../../src/native/reader.tsx', import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React}}).outputText
function platform(native) {
  const module = {exports: {}}
  vm.runInNewContext(compile(platformSource), {module, exports: module.exports, URL, require(name) {
    assert.equal(name, 'expo')
    return {requireNativeModule: name => {assert.equal(name, 'SlaxPlatform'); return native}}
  }})
  return module.exports
}

test('in-app browser adapter validates HTTP(S) URLs and preserves encoded URLs', async () => {
  const calls = []
  const api = platform({openInAppBrowser: async url => {calls.push(url)}})
  await api.openInAppBrowser('https://example.org/article?q=1%202#heading')
  await api.openInAppBrowser('http://example.org/')
  assert.deepEqual(calls, ['https://example.org/article?q=1%202#heading', 'http://example.org/'])
  for (const url of ['intent://example.org/#Intent;scheme=https;end', 'javascript:alert(1)', 'file:///private/a', 'data:text/html,x', 'slaxreader://route', '//example.org', 'https://name:password@example.org/', 'https://example.org\\@evil.org', 'https://example.org/\npath', ' https://example.org/', 'https://example.org/a b']) {
    await assert.rejects(api.openInAppBrowser(url), undefined, url)
  }
  assert.equal(calls.length, 2)
})

test('native browser launch and presentation failures reach the caller without a second JS launch', async () => {
  let attempts = 0
  const api = platform({openInAppBrowser: async () => {attempts++; throw new Error('No browser activity')}})
  await assert.rejects(api.openInAppBrowser('https://example.org'), /No browser activity/)
  assert.equal(attempts, 1)
  assert.doesNotMatch(platformSource, /Linking\.openURL|openBrowserAsync/)
})

test('native browser implementations use Safari and prefer provider-bound Custom Tabs', async () => {
  const swift = await readFile(new URL('../../modules/slax-platform/ios/SlaxPlatformModule.swift', import.meta.url), 'utf8')
  const kotlin = await readFile(new URL('../../modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxPlatformModule.kt', import.meta.url), 'utf8')
  assert.match(swift, /import SafariServices/)
  assert.match(swift, /present\(SFSafariViewController\(url: url\), animated: true\)/)
  assert.match(swift, /url\.user == nil, url\.password == nil/)
  assert.match(kotlin, /android\.support\.customtabs\.action\.CustomTabsService/)
  assert.match(kotlin, /if \(provider != null\) \{\s*intent\.setPackage\(provider\)/)
  assert.match(kotlin, /putBinder\("android\.support\.customtabs\.extra\.SESSION", null\)/)
  assert.doesNotMatch(kotlin, /Intent\.parseUri|import androidx\.browser/)
})

test('Android missing-provider fallback is an unbound validated HTTP(S) ACTION_VIEW', async () => {
  const kotlin = await readFile(new URL('../../modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxPlatformModule.kt', import.meta.url), 'utf8')
  const browser = kotlin.slice(kotlin.indexOf('AsyncFunction("openInAppBrowser")'), kotlin.indexOf('AsyncFunction("revokeReaderResources")'))
  assert.match(browser, /require\(uri\.scheme\?\.lowercase\(\) in listOf\("http", "https"\)/)
  assert.match(browser, /uri\.rawUserInfo == null/)
  assert.match(browser, /Intent\(android\.content\.Intent\.ACTION_VIEW, android\.net\.Uri\.parse\(uri\.toASCIIString\(\)\)\)\s*\.addCategory\(android\.content\.Intent\.CATEGORY_BROWSABLE\)\s*if \(provider != null\)/)
  assert.match(browser, /intent\.putExtra\("android\.support\.customtabs\.extra\.EXTRA_ENABLE_INSTANT_APPS", false\)\s*\}\s*activity\.startActivity\(intent\)/)
  assert.equal(browser.match(/setPackage\(provider\)/g)?.length, 1)
  assert.equal(browser.match(/activity\.startActivity\(intent\)/g)?.length, 1)
  assert.doesNotMatch(browser, /\?: error\("In-app browser unavailable"\)|catch\s*\(|Intent\.parseUri/)
})

test('Expo Reader imperative evaluation returns native completion and errors without the message event bridge', async () => {
  let nativeRef, imperative
  const React = {forwardRef: render => render, createElement: (type, props, ...children) => ({type, props, children})}
  const module = {exports: {}}
  vm.runInNewContext(compile(readerSource), {module, exports: module.exports, require(name) {
    if (name === 'react') return {__esModule: true, default: React, forwardRef: React.forwardRef,
      useRef: value => {const ref = {current: value}; nativeRef ??= ref; return ref}, useEffect() {},
      useImperativeHandle: (_ref, create) => {imperative = create()}}
    if (name === 'react-native') return {Platform: {OS: 'ios'}, StyleSheet: {create: value => value}, View: 'View'}
    if (name === 'expo') return {requireNativeView: () => 'NativeView'}
    if (name === 'react-native-reanimated') return {__esModule: true, default: {View: 'AnimatedView', createAnimatedComponent: component => component},
      useSharedValue: value => ({value}), useEvent: handler => handler, useAnimatedStyle: callback => callback()}
    throw new Error(name)
  }})
  module.exports.readerNativeAdapter.HostComponent({nativeConfig: {props: {pageId: 'page', cacheKey: 'key'}}, source: {html: '<p>body</p>'}}, {})
  await assert.rejects(imperative.evaluateJavaScript('script', 'page'), /unavailable/)
  const calls = []
  nativeRef.current = {evaluateJavaScript: async (...args) => {calls.push(args); return 'native result'}}
  assert.equal(await imperative.evaluateJavaScript('script', 'page'), 'native result')
  assert.deepEqual(calls, [['script', 'page']])
  nativeRef.current.evaluateJavaScript = async () => {throw new Error('released')}
  await assert.rejects(imperative.evaluateJavaScript('script', 'page'), /released/)
  for (const [code, name] of [['E_READER_INACTIVE', 'ReaderOperationCancelled'], ['E_READER_RELEASED', 'ReaderOperationCancelled'], ['E_READER_PROCESS_GONE', 'ReaderProcessGone']]) {
    nativeRef.current.evaluateJavaScript = async () => {throw Object.assign(new Error('native'), {code})}
    await assert.rejects(imperative.evaluateJavaScript('script', 'page'), error => error.name === name)
  }
  const genuine = Object.assign(new Error('evaluation failed'), {code: 'E_READER_EVALUATION'})
  nativeRef.current.evaluateJavaScript = async () => {throw genuine}
  await assert.rejects(imperative.evaluateJavaScript('script', 'page'), error => error === genuine)
  assert.ok(module.exports.readerNativeAdapter.OverlayComponent)
})
