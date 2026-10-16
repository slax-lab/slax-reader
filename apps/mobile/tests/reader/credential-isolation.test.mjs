import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {READER_CSP, READER_ORIGIN, readerProtectedHosts, readerAllowsUrl} from '../../src/reader/security.ts'
import {composeReaderDocument} from '../../src/reader/document.ts'

const config = {webUrl: 'https://reader.example.test', webDomain: '.example.test', apiUrl: 'https://api.other.test/v1', betaApiUrl: 'https://beta-api.other.test'}
const hosts = readerProtectedHosts(config)
const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('Reader origin is cross-site and all configured authentication hosts are protected by parsed domain boundaries', () => {
  assert.equal(READER_ORIGIN, 'https://reader.slax.invalid/')
  assert.deepEqual(hosts, ['api.other.test', 'beta-api.other.test', 'example.test', 'reader.example.test', 'slax.com'])
  for (const url of ['https://slax.com/', 'https://r.slax.com/', 'https://r.slax.com.:8443/x', 'https://READER.EXAMPLE.TEST/a', 'slaxstatics://api.other.test/image', 'slaxstatic://beta-api.other.test/a', 'https://x.example.test:9999/', 'https://user:pass@public.test/', 'https://public.test\\@example.test/a', 'data:text/html,x', 'javascript:alert(1)', 'file:///a']) assert.equal(readerAllowsUrl(url, hosts), false, url)
  for (const url of ['https://public.test/a.png', 'https://slax.com.public.test/a', 'https://notslax.com/a', 'slaxstatics://images.public.test/image', 'https://www.youtube.com/embed/abcdefghijk']) assert.equal(readerAllowsUrl(url, hosts), true, url)
  assert.throws(() => readerProtectedHosts({...config, webDomain: ''}))
  assert.throws(() => readerProtectedHosts({...config, apiUrl: 'https://user@api.other.test'}))
})

test('production CSP precedes executable article content and retains source markup and supported public frames', () => {
  const html = '<script>window.attack=true</script><meta http-equiv="Content-Security-Policy" content="default-src *"><iframe src="https://player.bilibili.com/player.html"></iframe><table><tr><td>content</td></tr></table>'
  const document = composeReaderDocument(html, {pageId: 'policy', platform: 'ios'})
  assert.ok(document.includes(html))
  assert.ok(document.indexOf(READER_CSP) < document.indexOf('installSlaxReaderHost'))
  assert.ok(document.indexOf(READER_CSP) < document.indexOf('window.attack'))
  for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "object-src 'none'", "worker-src 'none'", 'frame-src https:', 'https://www.youtube.com', 'https://s.ytimg.com']) assert.ok(READER_CSP.includes(directive))
  assert.ok(!READER_CSP.includes("script-src 'unsafe-inline' https:;"))
})

test('native document policy is required before load, origin is enforced, and authenticated cookie stores are not shared', async () => {
  const [swift, kotlin, reader, native] = await Promise.all([
    read('../../modules/slax-platform/ios/SlaxReaderView.swift'),
    read('../../modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxReaderView.kt'),
    read('../../src/reader/ReaderWebView.tsx'), read('../../src/native/reader.tsx'),
  ])
  assert.match(swift, /configuration\.websiteDataStore = \.nonPersistent\(\)/)
  assert.match(swift, /guard ownsResources, let protectedHosts, let imageProxyOrigins/)
  assert.match(swift, /compileContentRuleList/)
  assert.ok(swift.indexOf('userContentController.add(list)') < swift.indexOf('self.rulesReady = true'))
  assert.match(swift, /baseURL: security\.documentOrigin/)
  assert.match(swift, /guard !resources\.isFixture, security\.allows\(url\)/)
  assert.match(kotlin, /setAcceptThirdPartyCookies\(webView, false\)/)
  assert.doesNotMatch(kotlin, /setAcceptCookie\(|removeAllCookies\(/)
  assert.match(kotlin, /val hosts = protectedHosts \?: return/)
  assert.match(kotlin, /val proxies = imageProxyOrigins \?: return/)
  assert.doesNotMatch(kotlin, /if \(request\.method != "GET"\)/)
  assert.match(kotlin, /loadDataWithBaseURL\(security!!\.documentOrigin/)
  assert.match(kotlin, /security\?\.allows\(url\) != true/)
  assert.match(reader, /readerProtectedHosts\(mobileConfig\)/)
  assert.match(reader, /const documentSource = useMemo\(\(\) => \(\{html: document, baseUrl: READER_ORIGIN\}\), \[document\]\)/)
  assert.match(reader, /source=\{documentSource\}/)
  assert.match(native, /protectedHosts=\{nativeProps\.protectedHosts\}/)
})

test('custom-resource networking does not inherit WebView/global credentials and validates every redirect', async () => {
  const [swift, kotlin] = await Promise.all([
    read('../../modules/slax-platform/ios/SlaxResourceHandler.swift'),
    read('../../modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxResources.kt'),
  ])
  assert.match(swift, /URLSessionConfiguration\.ephemeral/)
  assert.match(swift, /httpCookieStorage = nil/)
  assert.match(swift, /urlCredentialStorage = nil/)
  assert.match(swift, /httpShouldHandleCookies = false/)
  assert.match(swift, /willPerformHTTPRedirection/)
  assert.match(swift, /redirects <= 10, let url = request\.url, permits\(url\)/)
  assert.match(swift, /security\.mediaOriginal\(custom\) : security\.imageOriginal\(custom\)/)
  assert.match(kotlin, /cookieJar\(CookieJar\.NO_COOKIES\)/)
  assert.match(kotlin, /authenticator\(Authenticator\.NONE\)/)
  assert.match(kotlin, /followRedirects\(false\)\.followSslRedirects\(false\)/)
  assert.match(kotlin, /redirects <= 10 && permits\(target\)/)
  assert.match(kotlin, /val policy = security \?: return denied\(\)/)
  assert.doesNotMatch(kotlin, /HttpURLConnection|CookieHandler|CookieManager|OkHttpClientProvider/)
})

test('Swift and Kotlin policies retain the same production CSP as the document composer', async () => {
  const [swift, kotlin] = await Promise.all([
    read('../../modules/slax-platform/ios/SlaxReaderSecurity.swift'),
    read('../../modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxReaderSecurity.kt'),
  ])
  assert.ok(swift.includes(`static let csp = "${READER_CSP}"`))
  assert.ok(kotlin.includes(`const val CSP = "${READER_CSP}"`))
  assert.match(swift, /"type": "block"/)
})
