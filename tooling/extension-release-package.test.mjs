import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { distributeRelease, inspectArchive, packageName, prepareRelease, readRelease, releaseIdentity } from './extension-release.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const sha = 'a'.repeat(40)
const keys = Object.fromEntries([...readFileSync(join(root, 'apps/extension/wxt.config.ts'), 'utf8').matchAll(/^  (preview|beta|production): '([^']+)'/gm)].map(m => [m[1], m[2]]))
const identity = branch => releaseIdentity({ manifest: { name: packageName, version: '1.2.3' }, branch, sha })
const config = { PUBLIC_BASE_URL: 'https://reader.example.test', AUTH_BASE_URL: 'https://reader.example.test', SHARE_BASE_URL: 'https://share.example.test', EXTENSIONS_API_BASE_URL: 'https://api.example.test', COOKIE_DOMAIN: '.example.test', COOKIE_TOKEN_NAME: 'slax_test' }
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'extension-release-package-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}
function zip(path, release, { manifest = {}, extra = [], omit = [] } = {}) {
  const entries = [
    ['manifest.json', JSON.stringify({ manifest_version: 3, version: release.baseVersion, version_name: release.version, key: keys[release.profile], icons: { 16: 'icon.png' }, background: { service_worker: 'background.js' }, action: { default_popup: 'popup.html' }, content_scripts: [{ js: ['content.js'], css: ['content.css'] }], web_accessible_resources: [{ resources: ['chunks/*.js'], matches: ['<all_urls>'] }], default_locale: 'en', ...manifest })],
    ['background.js', 'console.log("fixture")'], ['content.js', ''], ['content.css', ''], ['icon.png', 'fixture'], ['chunks/popup.js', ''], ['popup.html', '<script src="/chunks/popup.js"></script>'], ['_locales/en/messages.json', '{}'], ...extra
  ].filter(([name]) => !omit.includes(name))
  mkdirSync(dirname(path), { recursive: true })
  execFileSync('python3', ['-c', 'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED) as z:\n for name,content in json.load(sys.stdin): z.writestr(name,content)', path], { input: JSON.stringify(entries), stdio: ['pipe', 'pipe', 'pipe'] })
}
function artifact(t, branch = 'dev') {
  const directory = temporary(t)
  const release = identity(branch)
  const archive = join(directory, release.filename)
  zip(archive, release)
  const metadata = { ...release, sha256: digest(readFileSync(archive)) }
  writeFileSync(join(directory, 'release.json'), JSON.stringify(metadata))
  writeFileSync(join(directory, 'SHA256SUMS'), `${metadata.sha256}  ${release.filename}\n`)
  return { directory, release: metadata, archive }
}

test('actual ZIP inspection validates resources, numeric/display versions and existing profile IDs', t => {
  for (const branch of ['dev', 'beta', 'main']) {
    const a = artifact(t, branch)
    assert.equal(inspectArchive(a.archive, a.release).manifest.version, '1.2.3')
    assert.deepEqual(readRelease(a.directory, a.release), a.release)
    if (branch === 'main') {
      zip(a.archive, a.release, { manifest: { version_name: undefined } })
      assert.equal(inspectArchive(a.archive, a.release).manifest.version, '1.2.3')
    }
  }
})

test('ZIP inspection and source metadata reject corruption, traversal, missing resources and mismatches', t => {
  const a = artifact(t)
  for (const options of [
    { manifest: { version: '1.2.3-dev' } }, { manifest: { version_name: 'wrong' } }, { manifest: { version_name: undefined } }, { manifest: { key: keys.production } },
    { manifest: { manifest_version: 2 } }, { extra: [['../escape', 'fixture']] }, { extra: [['/escape', 'fixture']] },
    { extra: [['source.map', 'fixture']] }, { extra: [['.env.fixture', 'synthetic']] }, { extra: [['source.ts', 'fixture']] },
    { extra: [['icon.png', 'duplicate']] }, { omit: ['background.js'] }, { omit: ['chunks/popup.js'] },
    { omit: ['_locales/en/messages.json'] }, { extra: [['missing.html', '<link href="missing.css">']] }
  ]) {
    zip(a.archive, a.release, options)
    assert.throws(() => inspectArchive(a.archive, a.release))
  }
  zip(a.archive, a.release, { extra: [['changed.txt', 'changed bytes']] })
  assert.throws(() => readRelease(a.directory), /checksum/)
  zip(a.archive, a.release)
  assert.throws(() => readRelease(a.directory, { commit: 'b'.repeat(40) }), /identity/)
  writeFileSync(a.archive, 'not a ZIP')
  assert.throws(() => readRelease(a.directory), /archive/)
})

test('temporary WXT packaging strips credentials, retains source version and cleans up successful/failed builds', async t => {
  for (const branch of ['dev', 'beta', 'main']) {
    const cwd = temporary(t)
    const app = join(cwd, 'apps/extension')
    mkdirSync(app, { recursive: true })
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: packageName, version: '1.2.3', type: 'module' }))
    writeFileSync(join(app, 'env.schema.ts'), `export { extensionsEnvSchema } from ${JSON.stringify(pathToFileURL(join(root, 'apps/extension/env.schema.ts')).href)}`)
    const original = readFileSync(join(app, 'package.json'), 'utf8')
    const release = identity(branch)
    const directory = join(cwd, 'artifact')
    const env = { ...process.env, EXTENSION_BUILD_CONFIG: JSON.stringify(config), GH_TOKEN: 'SENSITIVE', GOOGLE_ANALYTICS_API_SECRET: 'SENSITIVE', SLAX_ENV: 'development' }
    let seenConfig
    const execute = async (program, args, options) => {
      assert.equal(program, 'pnpm')
      assert.deepEqual(args.slice(0, 4), ['extension', '--', 'zip', '-c'])
      seenConfig = args[4]
      const text = readFileSync(seenConfig, 'utf8')
      assert.ok(text.includes(`version_name: "${release.version}"`))
      assert.ok(!text.includes('version:'))
      assert.ok(!JSON.stringify(options.env).includes('SENSITIVE'))
      assert.equal(options.env.SLAX_ENV, release.profile)
      const output = JSON.parse(text.match(/outDir: ("[^"]+")/)[1])
      zip(join(output, 'fixture.zip'), release)
    }
    await prepareRelease(directory, env, { release, cwd, execute })
    assert.equal(existsSync(seenConfig), false)
    assert.deepEqual(readdirSync(join(app, 'build')), [])
    assert.equal(readFileSync(join(app, 'package.json'), 'utf8'), original)
    assert.equal(readRelease(directory).tag, release.tag)
    await assert.rejects(prepareRelease(join(cwd, 'failure'), env, { release, cwd, execute: async () => { throw Error('Build failed') } }), /Build failed/)
    assert.deepEqual(readdirSync(join(app, 'build')), [])
    await assert.rejects(prepareRelease(join(cwd, 'missing'), { ...env, EXTENSION_BUILD_CONFIG: '' }, { release, cwd, execute }), /EXTENSION_BUILD_CONFIG/)
  }
})

function github(release) {
  const state = { tag: null, remote: null, calls: [], uploads: [], failUpload: false }
  const request = async (path, options = {}) => {
    state.calls.push({ path, ...options })
    if (path.startsWith('/git/ref/tags/')) return state.tag
    if (path === '/git/refs') { state.tag = { object: { type: 'commit', sha: JSON.parse(options.body).sha } }; return state.tag }
    if (path.startsWith('/releases/tags/')) return state.remote
    if (path === '/releases') { const body = JSON.parse(options.body); state.remote = { id: 1, tag_name: body.tag_name, draft: false, prerelease: body.prerelease, assets: [] }; return state.remote }
    throw Error(`Unexpected fixture path: ${path}`)
  }
  const adapters = {
    request,
    readAsset: async asset => asset.bytes,
    uploadAsset: async (remote, asset) => {
      if (state.failUpload && asset.name === 'SHA256SUMS') throw Error('Upload failed')
      state.uploads.push(asset.name)
      remote.assets.push({ ...asset })
    }
  }
  return { state, adapters }
}

test('all channels publish exact bytes, preserve Latest and recover partial uploads without replacement', async t => {
  for (const branch of ['dev', 'beta', 'main']) {
    const a = artifact(t, branch)
    const { state, adapters } = github(a.release)
    state.failUpload = true
    await assert.rejects(distributeRelease(a.release, a.directory, adapters), /Upload failed/)
    assert.equal(state.remote.assets.length, 1)
    state.failUpload = false
    await distributeRelease(a.release, a.directory, adapters)
    await distributeRelease(a.release, a.directory, adapters)
    assert.deepEqual(state.uploads, [a.release.filename, 'SHA256SUMS'])
    assert.deepEqual(state.remote.assets[0].bytes, readFileSync(a.archive))
    assert.equal(state.tag.object.sha, sha)
    const creation = JSON.parse(state.calls.find(call => call.path === '/releases').body)
    assert.equal(creation.tag_name, a.release.tag)
    assert.equal(creation.prerelease, branch !== 'main')
    assert.equal(creation.make_latest, 'false')
    assert.equal(creation.target_commitish, sha)
  }
})

test('publication refuses corrupt artifacts, tag/asset/state conflicts and authentication failures', async t => {
  const a = artifact(t)
  const { state, adapters } = github(a.release)
  await distributeRelease(a.release, a.directory, adapters)
  state.tag.object.sha = 'b'.repeat(40)
  await assert.rejects(distributeRelease(a.release, a.directory, adapters), /tag conflict/)
  state.tag.object.sha = sha
  state.remote.prerelease = false
  await assert.rejects(distributeRelease(a.release, a.directory, adapters), /state mismatch/)
  state.remote.prerelease = true
  state.remote.assets[0].bytes = Buffer.from('different')
  await assert.rejects(distributeRelease(a.release, a.directory, adapters), /Conflicting/)
  state.remote.assets.push({ ...state.remote.assets[0] })
  await assert.rejects(distributeRelease(a.release, a.directory, adapters), /Duplicate/)
  await assert.rejects(distributeRelease(a.release, a.directory, { ...adapters, request: async () => { throw Error('Permission denied') } }), /Permission/)
  writeFileSync(a.archive, 'changed')
  let calls = 0
  await assert.rejects(distributeRelease(a.release, a.directory, { ...adapters, request: async () => { calls++ } }), /archive/)
  assert.equal(calls, 0)
})
