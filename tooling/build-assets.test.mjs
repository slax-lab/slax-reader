import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { acceptsContentType, BUILD_ASSETS_INDEX_PATH, buildAssetPath, validateBuildAssetsIndex, writeBuildAssetsIndex } from './build-assets.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function publicDir(t, files) {
  const directory = mkdtempSync(join(tmpdir(), 'build-assets-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const [path, bytes] of Object.entries(files)) {
    const file = join(directory, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
  return directory
}

test('the index lists every emitted file under /_nuxt/ with its digest, sorted, excluding mutable metadata', async t => {
  const files = {
    '/_nuxt/b.js': 'b', '/_nuxt/a.css': 'a', '/_nuxt/nested/font.woff2': 'f', '/_nuxt/sqlite.wasm': 'w',
    '/_nuxt/builds/latest.json': '{"id":"x"}', '/_nuxt/builds/meta/x.json': '{}', '/_nuxt/powersync-assets.json': '{}',
    '/index.html': '<html>', '/favicon.ico': 'i'
  }
  const directory = publicDir(t, files)
  const index = await writeBuildAssetsIndex(directory)
  assert.deepEqual(index.assets.map(asset => asset.path), ['/_nuxt/a.css', '/_nuxt/b.js', '/_nuxt/nested/font.woff2', '/_nuxt/sqlite.wasm'])
  for (const asset of index.assets) assert.equal(asset.sha256, hash(files[asset.path]))
  assert.deepEqual(JSON.parse(readFileSync(join(directory, BUILD_ASSETS_INDEX_PATH), 'utf8')), index)
  // Rewriting must not list the index itself.
  const again = await writeBuildAssetsIndex(directory)
  assert.deepEqual(again, index)
})

test('an unexpected or empty emitted file fails the build', async t => {
  await assert.rejects(writeBuildAssetsIndex(publicDir(t, { '/_nuxt/a.js': 'a', '/_nuxt/notes.txt': 'n' })), { category: 'invalid-path' })
  await assert.rejects(writeBuildAssetsIndex(publicDir(t, { '/_nuxt/a.js': '' })), { category: 'empty-resource' })
})

test('paths are confined to hashed /_nuxt/ assets', () => {
  for (const ok of ['/_nuxt/a.js', '/_nuxt/x/y.css', '/_nuxt/k.woff2', '/_nuxt/l.png', '/_nuxt/m.json', '/_nuxt/a.js.map']) assert.equal(buildAssetPath(ok), ok)
  for (const bad of ['/index.html', '/_nuxt/../a.js', '/_nuxt/.hidden.js', '/_nuxt/a.txt', '/_nuxt/builds/latest.json', '/_nuxt/build-assets.json', '/_nuxt/powersync-assets.json', 'https://x/_nuxt/a.js', 42]) {
    assert.throws(() => buildAssetPath(bad), { category: 'invalid-path' }, String(bad))
  }
})

test('malformed or duplicated indexes are rejected', () => {
  const good = { path: '/_nuxt/a.js', sha256: 'a'.repeat(64) }
  for (const bad of [null, [], {}, { assets: {} }, { assets: [], extra: 1 }, { assets: [{ ...good, extra: 1 }] }, { assets: [{ ...good, sha256: 'x' }] }, { assets: [good, good] }, { assets: [{ ...good, path: '/a.js' }] }]) {
    assert.throws(() => validateBuildAssetsIndex(bad), { category: 'invalid-build-index' })
  }
  assert.deepEqual(validateBuildAssetsIndex({ assets: [good] }), { assets: [good] })
})

test('content types must fit the extension', () => {
  assert.equal(acceptsContentType('/_nuxt/a.js', 'application/javascript'), true)
  assert.equal(acceptsContentType('/_nuxt/a.js', 'text/html'), false)
  assert.equal(acceptsContentType('/_nuxt/a.css', 'text/css; charset=utf-8'), true)
  assert.equal(acceptsContentType('/_nuxt/a.css', 'text/plain'), false)
  assert.equal(acceptsContentType('/_nuxt/a.js.map', 'application/json'), true)
  assert.equal(acceptsContentType('/_nuxt/a.js.map', 'text/html'), false)
  assert.equal(acceptsContentType('/_nuxt/a.wasm', 'application/wasm'), true)
  assert.equal(acceptsContentType('/_nuxt/a.woff2', 'font/woff2'), true)
  assert.equal(acceptsContentType('/_nuxt/a.ttf', 'application/octet-stream'), true)
  assert.equal(acceptsContentType('/_nuxt/a.png', 'image/png'), true)
  assert.equal(acceptsContentType('/_nuxt/a.svg', 'image/svg+xml'), true)
  assert.equal(acceptsContentType('/_nuxt/a.png', 'text/html'), false)
})
