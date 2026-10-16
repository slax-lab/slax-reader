import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const code = ts.transpileModule(await readFile(new URL('../../src/auth/providers.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText
const plain = value => JSON.parse(JSON.stringify(value))

function load(platform, {google, apple, config = {}} = {}) {
  const calls = [], exports = {}
  const success = {type: 'success', data: {idToken: 'synthetic-google-id-token', serverAuthCode: 'unused-synthetic-oauth-code'}}
  const boundaries = {
    'react-native': {Platform: {OS: platform}},
    '../config': {mobileConfig: {platform, googleWebClientId: 'synthetic-web.apps.googleusercontent.com', googleIosClientId: 'synthetic-ios.apps.googleusercontent.com', ...config}},
    '../native/platform': {googleSignIn: async clientId => {
      calls.push(['credentialManager', clientId])
      if (google?.nativeError) throw google.nativeError
      return google && Object.hasOwn(google, 'nativeToken') ? google.nativeToken : 'synthetic-google-id-token'
    }},
    'react-native-nitro-google-signin': {
      GoogleOneTapSignIn: {
        configure: value => calls.push(['configure', plain(value)]),
        checkPlayServices: async () => {calls.push(['checkPlayServices']); if (google?.playError) throw google.playError},
        signIn: async () => {calls.push(['silent']); if (google?.silentError) throw google.silentError; return google?.silent ?? success},
        createAccount: async () => {calls.push(['interactive']); if (google?.interactiveError) throw google.interactiveError; return google?.interactive ?? success},
      },
      isErrorWithCode: value => value && typeof value.code === 'string',
      statusCodes: {SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED'},
    },
    'expo-apple-authentication': {
      AppleAuthenticationScope: {FULL_NAME: 0, EMAIL: 1},
      signInAsync: async value => {
        calls.push(['apple', plain(value)])
        if (apple?.error) throw apple.error
        return apple?.credential ?? {authorizationCode: 'synthetic-apple-authorization-code', identityToken: 'synthetic-apple-id-token'}
      },
    },
  }
  vm.runInNewContext(code, {exports, require(name) {
    assert.ok(Object.hasOwn(boundaries, name), `Unexpected authentication boundary: ${name}`)
    return boundaries[name]
  }})
  return {...exports, calls}
}

test('iOS Google button presents the source interactive flow even with a cached native account', async () => {
  const provider = load('ios', {google: {silent: {type: 'success', data: {idToken: 'a-different-cached-account'}}}})
  assert.deepEqual(plain(await provider.authenticate('google')), {type: 'google', platform: 'ios', code: 'synthetic-google-id-token', redirect_uri: '', id_token: ''})
  assert.deepEqual(provider.calls.map(call => call[0]), ['configure', 'checkPlayServices', 'interactive'])
  assert.equal(provider.calls[0][1].offlineAccess, false)
})

test('Google native cancellation returns no backend login payload and never retries another picker', async () => {
  for (const result of [{interactive: {type: 'cancelled'}}, {interactiveError: {code: 'SIGN_IN_CANCELLED', message: 'Synthetic cancellation'}}]) {
    const provider = load('ios', {google: result})
    assert.equal(await provider.authenticate('google'), null)
    assert.equal(provider.calls.filter(call => call[0] === 'interactive').length, 1)
    assert.equal(provider.calls.some(call => call[0] === 'silent'), false)
  }
})

test('Android uses one source-compatible Credential Manager request and sends the returned ID token', async () => {
  const provider = load('android', {google: {silent: {type: 'noSavedCredentialFound'}, nativeToken: 'synthetic-android-id-token'}})
  assert.deepEqual(plain(await provider.authenticate('google')), {type: 'google', platform: 'android', code: 'synthetic-android-id-token', redirect_uri: '', id_token: ''})
  assert.deepEqual(provider.calls, [['credentialManager', 'synthetic-web.apps.googleusercontent.com']])
})

test('Android native cancellation sends no login payload and never opens a fallback picker', async () => {
  const provider = load('android', {google: {nativeToken: null}})
  assert.equal(await provider.authenticate('google'), null)
  assert.deepEqual(provider.calls, [['credentialManager', 'synthetic-web.apps.googleusercontent.com']])
})

test('Android native errors and missing tokens fail without opening a different account picker', async () => {
  const failure = {code: 'ERR_CREDENTIAL_PROVIDER', message: 'Synthetic Credential Manager failure'}
  const failed = load('android', {google: {nativeError: failure}})
  await assert.rejects(failed.authenticate('google'), error => error === failure)
  assert.deepEqual(failed.calls, [['credentialManager', 'synthetic-web.apps.googleusercontent.com']])
  const invalid = load('android', {google: {nativeToken: ''}})
  await assert.rejects(invalid.authenticate('google'), /identity token/)
  assert.equal(invalid.calls.length, 1)
})

test('Google errors, unavailable Play Services and missing tokens cannot become login payloads', async () => {
  const failure = {code: 'PLAY_SERVICES_NOT_AVAILABLE', message: 'Synthetic unavailable services'}
  const unavailable = load('ios', {google: {playError: failure}})
  await assert.rejects(unavailable.authenticate('google'), error => error === failure)
  assert.equal(unavailable.calls.some(call => ['silent', 'interactive'].includes(call[0])), false)
  const invalid = load('ios', {google: {interactive: {type: 'success', data: {idToken: null}}}})
  await assert.rejects(invalid.authenticate('google'), /identity token/)
})

test('Apple sends the source authorization-code and identity-token fields and handles native cancellation', async () => {
  const provider = load('ios')
  assert.deepEqual(plain(await provider.authenticate('apple')), {type: 'apple', platform: 'ios', code: 'synthetic-apple-authorization-code', redirect_uri: '', id_token: 'synthetic-apple-id-token'})
  assert.deepEqual(provider.calls, [['apple', {requestedScopes: [0, 1]}]])
  const cancelled = load('ios', {apple: {error: {code: 'ERR_REQUEST_CANCELED'}}})
  assert.equal(await cancelled.authenticate('apple'), null)
  const android = load('android')
  assert.equal(await android.authenticate('apple'), null)
  assert.deepEqual(android.calls, [])
})

test('missing public build IDs and incomplete Apple credentials fail before accepting a session', async () => {
  const unconfigured = load('ios', {config: {googleIosClientId: ''}})
  await assert.rejects(unconfigured.authenticate('google'), /client IDs/)
  assert.deepEqual(unconfigured.calls, [])
  const unconfiguredAndroid = load('android', {config: {googleWebClientId: ''}})
  await assert.rejects(unconfiguredAndroid.authenticate('google'), /client IDs/)
  assert.deepEqual(unconfiguredAndroid.calls, [])
  const invalid = load('ios', {apple: {credential: {authorizationCode: null, identityToken: 'synthetic-apple-id-token'}}})
  await assert.rejects(invalid.authenticate('apple'), /authorization code/)
})
