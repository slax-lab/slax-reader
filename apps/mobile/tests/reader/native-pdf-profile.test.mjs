import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {READER_CSP} from '../../src/reader/security.ts'
import {pdfCsp as composedPdfCsp} from '../../src/reader/pdf-types.ts'
import {React, nativeBoundary, loadComponent, withNativeHost} from './parity-host.mjs'

const root = new URL('../../modules/slax-platform/', import.meta.url)
const read = relative => readFile(new URL(relative, root), 'utf8')
const pdfPolicy = origin => `default-src 'none'; script-src 'nonce-slax-pdf-pdf-1' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src blob: ${origin}; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'`
const iosPdfCsp = pdfPolicy('slaxpdf://pdf'), androidPdfCsp = pdfPolicy('https://pdf.reader.slax.invalid')

test('composed PDF documents only connect to their own byte origin', () => {
  assert.equal(composedPdfCsp('slax-pdf-pdf-1', 'ios'), iosPdfCsp)
  assert.equal(composedPdfCsp('slax-pdf-pdf-1', 'android'), androidPdfCsp)
  assert.equal(composedPdfCsp('slax-pdf-pdf-1'), androidPdfCsp)
})

test('PDF uses the same owned native no-menu subclass and cannot change profiles after document binding', async () => {
  const [swift, kotlin, swiftModule, kotlinModule, pdf, native] = await Promise.all([
    read('ios/SlaxReaderView.swift'), read('android/src/main/java/com/slax/reader/platform/SlaxReaderView.kt'),
    read('ios/SlaxPlatformModule.swift'), read('android/src/main/java/com/slax/reader/platform/SlaxPlatformModule.kt'),
    readFile(new URL('../../src/reader/PdfWebView.tsx', import.meta.url), 'utf8'), readFile(new URL('../../src/native/reader.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(pdf, /Host = readerNativeAdapter\.HostComponent/)
  assert.match(pdf, /pdfMode: true/)
  assert.doesNotMatch(pdf, /menuItems=|pdf-bridge-state|import \{WebView\}/)
  assert.match(native, /pdfMode=\{nativeProps\.pdfMode === true\}/)
  assert.match(native, /cacheDirectory=\{nativeProps\.cacheDirectory\}/)
  assert.match(native, /pdfSource=\{nativeProps\.pdfMode === true \? nativeProps\.pdfSource \?\? null : null\}/)
  assert.doesNotMatch(pdf, /readRange|rangeChunk|btoa|encode\(/, 'PDF bytes never cross the React Native bridge')
  assert.match(swift, /setURLSchemeHandler\(pdfRanges, forURLScheme: SlaxPdfSchemeHandler\.scheme\)/)
  assert.match(swift, /pdfRanges\.scope = \{[^}]*self\.pdfMode, !self\.resources\.isFixture, self\.ownsResources/)
  assert.match(kotlin, /if \(pdfMode && !request\.isForMainFrame\) pdfRanges\.handle/)
  assert.match(kotlin, /if \(!pdfMode \|\| resourceHandler\.isFixture \|\| detached \|\| owner == null \|\| owner != activeOwner/)
  assert.match(swift, /webView = SlaxNoMenuWebView/)
  assert.match(swift, /override func canPerformAction[^\n]+false/)
  assert.match(swift, /builder\.replaceChildren\(ofMenu: \.root\) \{ _ in \[\] \}/)
  assert.match(kotlin, /override fun startActionMode\(callback: ActionMode\.Callback\): ActionMode\? = super\.startActionMode\(suppress\(callback\)\)/)
  assert.match(kotlin, /override fun startActionMode\(callback: ActionMode\.Callback, type: Int\): ActionMode\? = super\.startActionMode\(suppress\(callback\), type\)/)
  for (const source of [swift, kotlin]) {
    assert.match(source, /setPdfMode/)
    assert.match(source, /pdfMode != value && \(loaded != nil \|\| security != nil\)|pdfMode != value && \(loaded != null \|\| security != null\)/)
    assert.match(source, /resourceOwner != nil && resourceOwner == Self\.activeOwner|resourceOwner != null && resourceOwner == activeOwner/)
    assert.match(source, /isFixture && !pdfMode/)
  }
  assert.match(swiftModule, /Prop\("pdfMode"\)[^\n]+value: Bool/)
  assert.match(kotlinModule, /Prop\("pdfMode"\)[^\n]+value: Boolean/)
  assert.match(swiftModule, /Prop\("pdfSource"\)[^\n]+setPdfSource/)
  assert.match(kotlinModule, /Prop\("pdfSource"\)[^\n]+setPdfSource/)
  assert.match(kotlinModule, /Prop\("scrollEnabled"\)[^\n]+setDocumentScrollEnabled/)
  assert.match(swiftModule, /Prop\("scrollEnabled"\)[^\n]+isScrollEnabled/)
  assert.match(native, /scrollEnabled=\{props\.scrollEnabled !== false\}/)
  assert.match(kotlin, /override fun canScrollVertically[^\n]+documentScrollEnabled/)
  assert.match(kotlin, /override fun onOverScrolled/)
  assert.match(kotlin, /super\.scrollTo\(if \(documentScrollEnabled\) x else 0, if \(documentScrollEnabled\) y else 0\)/)
  assert.match(kotlin, /blockNetworkLoads = pdfMode \|\| resourceHandler\.isFixture/)
  assert.match(kotlin, /pdfMode && !request\.isForMainFrame && request\.url\.scheme in listOf\("blob", "data"\)/)
  assert.match(kotlin, /html = ""; loaded = null; loadedPageId = null; loadedOwner = null/)
  assert.match(kotlin, /retainedWebView = null/)
  assert.ok(kotlin.indexOf('endViewTransition(it)') < kotlin.indexOf('removeView(it)'))
  assert.ok(kotlin.indexOf('removeView(it)') < kotlin.indexOf('it.destroy()'))
  assert.match(kotlin, /fun injectJavaScript\(script: String\) \{ if \(permitsEvaluation\(\)\)/)
  assert.doesNotMatch(kotlinModule, /view\.webView\.(?:evaluateJavascript|stopLoading|scrollTo)/)
})

const policyCompilers = process.platform === 'darwin' && spawnSync('xcrun', ['--find', 'swiftc']).status === 0 && ['kotlinc', 'java'].every(command => spawnSync('which', [command]).status === 0)
test('compiled Swift and Kotlin PDF policies retain nonce workers while rejecting network and HTML profile escalation', {timeout: 120000, skip: !policyCompilers && 'Installed Swift and Kotlin compilers are required'}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slax-pdf-policy-'))
  const page = csp => `<html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>PDF</body></html>`
  const run = (command, args) => {
    const result = spawnSync(command, args, {encoding: 'utf8', timeout: 60000})
    assert.equal(result.status, 0, `${command}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
  }
  try {
    const pdfCsp = iosPdfCsp
    const swift = `import Foundation
let html = ${JSON.stringify(page(iosPdfCsp))}
let pdf = try SlaxReaderSecurity(["slax.com"], pdfMode: true)
let article = try SlaxReaderSecurity(["slax.com"])
precondition(pdf.documentOrigin.absoluteString == "slaxpdf://pdf/" && pdf.documentOrigin == URL(string: "slaxpdf://pdf/")!)
precondition(article.documentOrigin == SlaxReaderSecurity.origin)
precondition(SlaxReaderSecurity.csp == ${JSON.stringify(READER_CSP)})
precondition(try SlaxReaderSecurity.pdfCsp("pdf-1") == ${JSON.stringify(pdfCsp)})
let document = try SlaxReaderSecurity.pdfDocument(html, pageId: "pdf-1")
precondition(document.components(separatedBy: ${JSON.stringify(pdfCsp)}).count == 3)
precondition(!document.contains("worker-src 'none'"))
precondition(SlaxReaderSecurity.document(html).contains("worker-src 'none'"))
for raw in ["https://public.example/file", "slaxstatics://public.example/file", "https://slax.com/static/image"] {
  let url = URL(string: raw)!
  precondition(!pdf.allows(url) && pdf.imageOriginal(url) == nil && pdf.mediaOriginal(url) == nil)
}
precondition(article.allows(URL(string: "https://public.example/file")!))
precondition((try? SlaxReaderSecurity.pdfDocument("<html><head></head></html>", pageId: "pdf-1")) == nil)
precondition((try? SlaxReaderSecurity.pdfDocument(html, pageId: "other")) == nil)
precondition((try? SlaxReaderSecurity.pdfCsp("x' unsafe-inline")) == nil)
let rules = try JSONSerialization.jsonObject(with: pdf.contentRules().data(using: .utf8)!) as! [[String: Any]]
precondition((rules.first?["trigger"] as? [String: Any])?["url-filter"] as? String == "^https?://")
`
    await writeFile(join(directory, 'main.swift'), swift.replace('precondition(try SlaxReaderSecurity.pdfCsp("pdf-1") ==', 'let actualCsp = try SlaxReaderSecurity.pdfCsp("pdf-1")\nprecondition(actualCsp =='))
    run('xcrun', ['swiftc', new URL('ios/SlaxReaderSecurity.swift', root).pathname, join(directory, 'main.swift'), '-o', join(directory, 'swift-policy')])
    run(join(directory, 'swift-policy'), [])
    const kotlin = `package com.slax.reader.platform
fun main() {
  val html = ${JSON.stringify(page(androidPdfCsp))}
  val pdf = SlaxReaderSecurity(listOf("slax.com"), pdfMode = true)
  val article = SlaxReaderSecurity(listOf("slax.com"))
  check(pdf.documentOrigin == "https://pdf.reader.slax.invalid/")
  check(article.documentOrigin == SlaxReaderSecurity.ORIGIN)
  check(SlaxReaderSecurity.CSP == ${JSON.stringify(READER_CSP)})
  check(SlaxReaderSecurity.pdfCsp("pdf-1") == ${JSON.stringify(androidPdfCsp)})
  val document = SlaxReaderSecurity.pdfDocument(html, "pdf-1")
  check(document.split(${JSON.stringify(androidPdfCsp)}).size == 3)
  check(!document.contains("worker-src 'none'"))
  check(SlaxReaderSecurity.document(html).contains("worker-src 'none'"))
  for (url in listOf("https://public.example/file", "slaxstatics://public.example/file", "https://slax.com/static/image")) {
    check(!pdf.allows(url) && pdf.imageOriginal(url) == null && pdf.mediaOriginal(url) == null)
  }
  check(article.allows("https://public.example/file"))
  check(runCatching { SlaxReaderSecurity.pdfDocument("<html><head></head></html>", "pdf-1") }.isFailure)
  check(runCatching { SlaxReaderSecurity.pdfDocument(html, "other") }.isFailure)
  check(runCatching { SlaxReaderSecurity.pdfCsp("x' unsafe-inline") }.isFailure)
}
`
    await writeFile(join(directory, 'Main.kt'), kotlin)
    run('kotlinc', [new URL('android/src/main/java/com/slax/reader/platform/SlaxReaderSecurity.kt', root).pathname, join(directory, 'Main.kt'), '-include-runtime', '-d', join(directory, 'policy.jar')])
    run('java', ['-jar', join(directory, 'policy.jar')])
  } finally {await rm(directory, {recursive: true, force: true})}
})

function nativeHeightMotion(host) {
  const values = [], handlers = []
  const AnimatedView = React.forwardRef((props, ref) => React.createElement(host.native.View, {...props, ref, testID: props.testID ?? 'animated-document-container'}))
  return {values, handlers, module: {__esModule: true, default: {View: AnimatedView, createAnimatedComponent: component => component},
    useSharedValue(initial) {return React.useMemo(() => {const value = {value: initial}; values.push(value); return value}, [])},
    useEvent(handler, names) {return React.useMemo(() => {const registered = {worklet: handler, names}; handlers.push(registered); return registered}, [])},
    useAnimatedStyle: callback => ({animated: callback})}}
}

test('android article host applies native content height on the UI thread without rerendering the document host', nativeBoundary, async () => {
  await withNativeHost(async host => {
    host.native.Platform.OS = 'android'
    let nativeProps, renders = 0
    const NativeView = React.forwardRef((props, ref) => {
      nativeProps = props; renders++
      React.useImperativeHandle(ref, () => ({detach: async () => {}, setScrollsToTop: async () => {}}))
      return React.createElement('div')
    })
    const motion = nativeHeightMotion(host)
    const {readerNativeAdapter} = await loadComponent('../../src/native/reader.tsx', {react: React, 'react-native': host.native,
      'expo': {requireNativeView: (_module, name) => name === 'SlaxReaderView' ? NativeView : host.native.View}, 'react-native-reanimated': motion.module})
    assert.equal(readerNativeAdapter.appliesContentHeight, true)
    const context = {pageId: 'article-1', cacheKey: 'cache', resourceOwner: 'account-owner', protectedHosts: ['slax.com'], imageProxyOrigins: [], suppressSelectionMenu: true, scrollsToTop: true}
    await host.render(React.createElement(readerNativeAdapter.HostComponent, {source: {html: '<p>Article</p>'}, nativeConfig: readerNativeAdapter.nativeConfig(context), containerStyle: {flex: 0}}))
    const [handler] = motion.handlers
    assert.deepEqual([...handler.names], ['onContentHeight'])
    assert.equal(nativeProps.onContentHeight, handler, 'The native view event is bound to the worklet handler, not a React callback')
    const container = host.props.get('animated-document-container')
    const animated = container.style.find(value => value && value.animated).animated
    assert.equal(animated().height, 1)
    const settled = renders
    for (const height of [1200, 1800, 2400]) handler.worklet({height})
    handler.worklet({height: Number.NaN})
    assert.equal(animated().height, 2400)
    assert.equal(renders, settled, 'Height changes never rerender the document host')
  })
})

test('android article host sizes from the bridge height when no native content-height event ever fires', nativeBoundary, async () => {
  await withNativeHost(async host => {
    host.native.Platform.OS = 'android'
    let renders = 0
    const NativeView = React.forwardRef((props, ref) => {
      renders++
      React.useImperativeHandle(ref, () => ({detach: async () => {}, setScrollsToTop: async () => {}}))
      return React.createElement('div')
    })
    const motion = nativeHeightMotion(host)
    const {readerNativeAdapter} = await loadComponent('../../src/native/reader.tsx', {react: React, 'react-native': host.native,
      'expo': {requireNativeView: (_module, name) => name === 'SlaxReaderView' ? NativeView : host.native.View}, 'react-native-reanimated': motion.module})
    const context = {pageId: 'article-1', cacheKey: 'cache', resourceOwner: 'account-owner', protectedHosts: ['slax.com'], imageProxyOrigins: [], suppressSelectionMenu: true, scrollsToTop: true}
    const ref = React.createRef()
    await host.render(React.createElement(readerNativeAdapter.HostComponent, {ref, source: {html: '<p>Article</p>'}, nativeConfig: readerNativeAdapter.nativeConfig(context), containerStyle: {flex: 0}}))
    const animated = host.props.get('animated-document-container').style.find(value => value && value.animated).animated
    const settled = renders
    ref.current.applyDocumentHeight(1200)
    assert.equal(animated().height, 1200, 'Without a native measurement the bridge height sizes the document')
    ref.current.applyDocumentHeight(Number.NaN); ref.current.applyDocumentHeight(0)
    assert.equal(animated().height, 1200)
    motion.handlers[0].worklet({height: 1500})
    ref.current.applyDocumentHeight(1300)
    assert.equal(animated().height, 1500, 'The first native measurement takes over from the bridge height')
    assert.equal(renders, settled, 'The bridge fallback never rerenders the document host')
  })
})

for (const platform of ['ios', 'android']) test(`${platform} native adapter forwards the locked PDF profile, owner, fixture root and page-bound messages`, nativeBoundary, async () => {
  await withNativeHost(async host => {
    host.native.Platform.OS = platform
    let nativeProps, detached = 0
    const messages = []
    const NativeView = React.forwardRef((props, ref) => {
      nativeProps = props
      React.useImperativeHandle(ref, () => ({detach: async () => {detached++}, setScrollsToTop: async () => {}}))
      return React.createElement('div')
    })
    const {readerNativeAdapter} = await loadComponent('../../src/native/reader.tsx', {react: React, 'react-native': host.native,
      'expo': {requireNativeView: (_module, name) => name === 'SlaxReaderView' ? NativeView : host.native.View}, 'react-native-reanimated': nativeHeightMotion(host).module})
    const pdfSource = {id: 'doc', collectionOwner: 'owner', documentId: 'a'.repeat(64), size: 1024}
    const origin = platform === 'ios' ? 'slaxpdf://pdf/' : 'https://pdf.reader.slax.invalid/'
    const context = {pageId: 'pdf-1', cacheKey: 'collection-owner-doc', cacheDirectory: '/controlled/slax-ui-fixtures/fixture', resourceOwner: 'account-owner', pdfMode: true, pdfSource, protectedHosts: ['slax.com'], imageProxyOrigins: [], suppressSelectionMenu: true, scrollsToTop: true}
    await host.render(React.createElement(readerNativeAdapter.HostComponent, {source: {html: '<html></html>', baseUrl: origin}, nativeConfig: readerNativeAdapter.nativeConfig(context), onMessage: event => messages.push(event.nativeEvent)}))
    assert.equal(nativeProps.pdfMode, true)
    assert.deepEqual(nativeProps.pdfSource, pdfSource)
    assert.equal(nativeProps.onContentHeight, undefined, 'PDF keeps its own document-height path')
    assert.equal(nativeProps.resourceOwner, context.resourceOwner)
    assert.equal(nativeProps.cacheDirectory, context.cacheDirectory)
    nativeProps.onEvent({nativeEvent: {type: 'message', target: 1, pageId: 'stale', data: '{}'}})
    assert.equal(messages.length, 0)
    nativeProps.onEvent({nativeEvent: {type: 'message', target: 1, pageId: 'pdf-1', data: '{}'}})
    assert.equal(messages[0].url, origin)
    const lateEvent = nativeProps.onEvent
    await host.unmount()
    assert.equal(detached, 1)
    lateEvent({nativeEvent: {type: 'message', target: 1, pageId: 'pdf-1', data: '{"late":true}'}})
    assert.equal(messages.length, 1)
    assert.throws(() => readerNativeAdapter.attach(1, context), /no longer attached/)
  })
})
