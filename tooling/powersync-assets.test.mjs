import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  AssetValidationError, POWER_SYNC_INDEX_PATH, applyPowerSyncHeaders,
  collectLegacyAssets, createPowerSyncAssetBuild, generateAssetIndex, inspectJavaScript, validateAssetBytes,
  validateAssetIndex, validateCurrentAssets,
} from './powersync-assets.mjs'

const root = '/_nuxt/worker-v4.js'
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
const fixture = new Map([
  [root, Buffer.from('export { connect } from "./shared-a.js"; export const open = () => import("./sqlite-a.js");')],
  ['/_nuxt/shared-a.js', Buffer.from('export function connect() {}')],
  ['/_nuxt/sqlite-a.js', Buffer.from('export const url = new URL(new URL("./sqlite-a.wasm", import.meta.url).href, import.meta.url);')],
  ['/_nuxt/sqlite-a.wasm', wasm],
])
async function stage(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'powersync-assets-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, '_nuxt'))
  for (const [name, bytes] of fixture) await writeFile(path.join(dir, name), bytes)
  await writeFile(path.join(dir, '_nuxt/pdf-worker.js'), 'export const unrelated = true')
  return dir
}

test('indexes the transitive emitted JS/WASM graph without unrelated workers', async t => {
  const dir = await stage(t)
  const index = await generateAssetIndex(dir, [root])
  assert.deepEqual(index.roots, [root])
  assert.deepEqual(index.assets.map(asset => asset.path), [
    '/_nuxt/shared-a.js', '/_nuxt/sqlite-a.js', '/_nuxt/sqlite-a.wasm', root,
  ])
  assert.equal(index.assets.find(asset => asset.path.endsWith('.wasm')).sha256, '93a44bbb96c751218e4c00d479e4c14358122a389acca16205b1e4d0dc5f9476')
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, POWER_SYNC_INDEX_PATH), 'utf8')), index)
})

test('current validation rejects an omitted transitive dependency and missing root', async t => {
  const dir = await stage(t)
  const index = await generateAssetIndex(dir, [root])
  index.assets = index.assets.filter(asset => !asset.path.endsWith('.wasm'))
  await writeFile(path.join(dir, POWER_SYNC_INDEX_PATH), JSON.stringify(index))
  await assert.rejects(validateCurrentAssets(dir), error => error.category === 'incomplete-index')
  index.roots = []
  await writeFile(path.join(dir, POWER_SYNC_INDEX_PATH), JSON.stringify(index))
  await assert.rejects(validateCurrentAssets(dir), error => error.category === 'invalid-index')
})

test('current generation rejects HTML, invalid wasm, and missing dependency', async t => {
  const dir = await stage(t)
  await writeFile(path.join(dir, '/_nuxt/sqlite-a.wasm'), '<!DOCTYPE html>')
  await assert.rejects(generateAssetIndex(dir, [root]), error => error.category === 'invalid-wasm')
  await writeFile(path.join(dir, '/_nuxt/sqlite-a.wasm'), Buffer.from([0, 97, 115, 109]))
  await assert.rejects(generateAssetIndex(dir, [root]), error => error.category === 'invalid-wasm')
  await rm(path.join(dir, '/_nuxt/sqlite-a.wasm'))
  await assert.rejects(generateAssetIndex(dir, [root]), error => error.category === 'missing-resource')
})

test('current validation rejects changed bytes after index generation', async t => {
  const dir = await stage(t)
  await generateAssetIndex(dir, [root])
  await writeFile(path.join(dir, '/_nuxt/shared-a.js'), 'export function connect() { return 2 }')
  await assert.rejects(validateCurrentAssets(dir), error => error.category === 'digest-mismatch')
})

test('legacy discovery follows nested asset URLs but never executes historical scripts', async () => {
  const files = new Map(fixture)
  files.set(root, Buffer.from(`${files.get(root)}; globalThis.__powersyncUntrustedExecuted = true;`))
  const result = await collectLegacyAssets({ roots: [root], readAsset: async name => files.get(name), onWarning: () => assert.fail('Unexpected warning') })
  assert.equal(result.complete, true)
  assert.equal(globalThis.__powersyncUntrustedExecuted, undefined)
  assert.deepEqual([...result.files.keys()].sort(), [...fixture.keys()].sort())
})

test('legacy recovery retains independent valid files and reports unresolved or absent dependencies', async () => {
  const warnings = []
  const files = new Map(fixture)
  files.set(root, Buffer.from(`${files.get(root)}; import(variable); new URL(dynamicWasm, import.meta.url);`))
  const result = await collectLegacyAssets({
    roots: [root],
    readAsset: async name => {
      if (name.endsWith('.wasm')) throw new AssetValidationError('missing-resource', name)
      return files.get(name)
    },
    onWarning: warning => warnings.push(warning),
  })
  assert.equal(result.complete, false)
  assert.equal(result.files.size, 3)
  assert.deepEqual(warnings.map(warning => warning.category).sort(), ['missing-resource', 'unsupported-dependency'])
})

test('static extraction ignores comments, strings, inline data and ordinary dynamic API URLs', () => {
  const code = `// import('./fake.js')
    const text = "import('also-fake.js')";
    const request = new URL(input, apiBase);
    fetch(request);
    const inline = new URL('data:application/wasm;base64,AGFzbQEAAAA=', import.meta.url);
    export { value } from './real.js';`
  assert.deepEqual(inspectJavaScript(Buffer.from(code), root), { dependencies: ['/_nuxt/real.js'], unresolved: false })
})

test('index validation rejects traversal, external paths, duplicates and metadata', () => {
  const sha256 = '0'.repeat(64)
  for (const value of [
    { roots: [root], assets: [{ path: '/_nuxt/../secrets.js', sha256 }] },
    { roots: ['https://example.test/worker.js'], assets: [] },
    { roots: [root], assets: [{ path: root, sha256 }, { path: root, sha256 }] },
    { roots: [root], assets: [{ path: root, sha256 }], releaseId: 'private' },
  ]) assert.throws(() => validateAssetIndex(value), AssetValidationError)
  assert.throws(() => validateAssetBytes(root, Buffer.from('<html>oops</html>')), error => error.category === 'invalid-js')
})

test('unexpected programming errors are not converted to history warnings', async () => {
  await assert.rejects(collectLegacyAssets({ roots: [root], readAsset: () => { throw new TypeError('programming defect') }, onWarning: () => assert.fail('swallowed bug') }), TypeError)
})

test('header generation detaches inherited immutable policy for mutable entries and index only', async t => {
  const dir = await stage(t)
  await writeFile(path.join(dir, '_headers'), '/_nuxt/*\n  Cache-Control: public, max-age=31536000, immutable\n')
  await writeFile(path.join(dir, '_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude: ['/_nuxt/*'] }))
  await applyPowerSyncHeaders(dir, [root])
  await applyPowerSyncHeaders(dir, [root, '/_nuxt/worker-v3.js'])
  const headers = await readFile(path.join(dir, '_headers'), 'utf8')
  assert.match(headers, /\/_nuxt\/worker-v4\.js\n  ! Cache-Control\n  Cache-Control: no-cache, max-age=0, must-revalidate/)
  assert.match(headers, /\/_nuxt\/powersync-assets\.json\n  ! Cache-Control\n  Cache-Control: no-cache, max-age=0, must-revalidate/)
  assert.match(headers, /\/_nuxt\/worker-v3\.js\n  ! Cache-Control/)
  assert.equal(headers.match(/\/_nuxt\/worker-v4\.js/g).length, 1)
  assert.match(headers, /\/_nuxt\/\*\n  Cache-Control: public, max-age=31536000, immutable/)
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, '_routes.json'), 'utf8')).exclude, ['/_nuxt/*'])
})


test('build hooks select PowerSync roots from module identity and cross-check emitted dependencies', async t => {
  const dir = await stage(t)
  await writeFile(path.join(dir, '_headers'), '/_nuxt/*\n  Cache-Control: public, max-age=31536000, immutable\n')
  await writeFile(path.join(dir, '_routes.json'), JSON.stringify({ exclude: ['/_nuxt/*'] }))
  const build = createPowerSyncAssetBuild()
  const plugin = build.plugin()
  plugin.generateBundle({}, {
    '_nuxt/sqlite3-worker1-v4.js': { type: 'chunk', isEntry: true, facadeModuleId: '/node_modules/unrelated/sqlite3-worker1.js', fileName: '_nuxt/sqlite3-worker1-v4.js', imports: [], dynamicImports: [] },
  })
  await assert.rejects(build.write(dir), error => error.category === 'missing-worker-roots')
  plugin.generateBundle({}, {
    '_nuxt/worker-v4.js': { type: 'chunk', isEntry: true, facadeModuleId: '/node_modules/@powersync/web/lib/worker/worker.js', fileName: '_nuxt/worker-v4.js', imports: ['_nuxt/shared-a.js'], dynamicImports: ['_nuxt/sqlite-a.js'] },
    '_nuxt/shared-a.js': { type: 'chunk', fileName: '_nuxt/shared-a.js', imports: [], dynamicImports: [] },
    '_nuxt/sqlite-a.js': { type: 'chunk', fileName: '_nuxt/sqlite-a.js', imports: [], dynamicImports: [], viteMetadata: { importedAssets: new Set(['_nuxt/sqlite-a.wasm']) } },
    '_nuxt/sqlite-a.wasm': { type: 'asset', fileName: '_nuxt/sqlite-a.wasm' },
  })
  const index = await build.write(dir)
  assert.equal(index.assets.length, 4)
  assert.deepEqual(index.roots, [root])
  plugin.generateBundle({}, {
    '_nuxt/worker-v4.js': { type: 'chunk', isEntry: true, facadeModuleId: '/node_modules/@powersync/web/lib/worker/worker.js', fileName: '_nuxt/worker-v4.js', imports: [], dynamicImports: [], viteMetadata: { importedAssets: new Set(['_nuxt/hidden.wasm']) } },
    '_nuxt/hidden.wasm': { type: 'asset', fileName: '_nuxt/hidden.wasm' },
  })
  await assert.rejects(build.write(dir), error => error.category === 'incomplete-index')
})
