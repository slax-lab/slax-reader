import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {READER_CSP} from '../../src/reader/security.ts'
import {React, nativeBoundary, loadComponent, withNativeHost} from './parity-host.mjs'

const root = new URL('../../modules/slax-platform/', import.meta.url)
const read = relative => readFile(new URL(relative, root), 'utf8')
const pdfCsp = "default-src 'none'; script-src 'nonce-slax-pdf-pdf-1' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src blob:; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"

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
  const html = `<html><head><meta http-equiv="Content-Security-Policy" content="${pdfCsp}"></head><body>PDF</body></html>`
  const run = (command, args) => {
    const result = spawnSync(command, args, {encoding: 'utf8', timeout: 60000})
    assert.equal(result.status, 0, `${command}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
  }
  try {
    const swift = `import Foundation
let html = ${JSON.stringify(html)}
let pdf = try SlaxReaderSecurity(["slax.com"], pdfMode: true)
let article = try SlaxReaderSecurity(["slax.com"])
precondition(pdf.documentOrigin.absoluteString == "https://pdf.reader.slax.invalid/")
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
  val html = ${JSON.stringify(html)}
  val pdf = SlaxReaderSecurity(listOf("slax.com"), pdfMode = true)
  val article = SlaxReaderSecurity(listOf("slax.com"))
  check(pdf.documentOrigin == "https://pdf.reader.slax.invalid/")
  check(article.documentOrigin == SlaxReaderSecurity.ORIGIN)
  check(SlaxReaderSecurity.CSP == ${JSON.stringify(READER_CSP)})
  check(SlaxReaderSecurity.pdfCsp("pdf-1") == ${JSON.stringify(pdfCsp)})
  val document = SlaxReaderSecurity.pdfDocument(html, "pdf-1")
  check(document.split(${JSON.stringify(pdfCsp)}).size == 3)
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
      'expo-modules-core': {requireNativeViewManager: (_module, name) => name === 'SlaxReaderView' ? NativeView : host.native.View}})
    const context = {pageId: 'pdf-1', cacheKey: 'cache', cacheDirectory: '/controlled/slax-ui-fixtures/fixture', resourceOwner: 'account-owner', pdfMode: true, protectedHosts: ['slax.com'], imageProxyOrigins: [], suppressSelectionMenu: true, scrollsToTop: true}
    await host.render(React.createElement(readerNativeAdapter.HostComponent, {source: {html: '<html></html>', baseUrl: 'https://pdf.reader.slax.invalid/'}, nativeConfig: readerNativeAdapter.nativeConfig(context), onMessage: event => messages.push(event.nativeEvent)}))
    assert.equal(nativeProps.pdfMode, true)
    assert.equal(nativeProps.resourceOwner, context.resourceOwner)
    assert.equal(nativeProps.cacheDirectory, context.cacheDirectory)
    nativeProps.onEvent({nativeEvent: {type: 'message', target: 1, pageId: 'stale', data: '{}'}})
    assert.equal(messages.length, 0)
    nativeProps.onEvent({nativeEvent: {type: 'message', target: 1, pageId: 'pdf-1', data: '{}'}})
    assert.equal(messages[0].url, 'https://pdf.reader.slax.invalid/')
    const lateEvent = nativeProps.onEvent
    await host.unmount()
    assert.equal(detached, 1)
    lateEvent({nativeEvent: {type: 'message', target: 1, pageId: 'pdf-1', data: '{"late":true}'}})
    assert.equal(messages.length, 1)
    assert.throws(() => readerNativeAdapter.attach(1, context), /no longer attached/)
  })
})
