import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverSnapshots, preparePowerSyncRetention, HistoricalRecoveryError, formatRetentionSummary } from './powersync-retention.mjs'

const now = Date.parse('2026-11-02T12:00:00Z')
const day = 86_400_000
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const snapshot = (key, age, extra = {}) => ({
  id: `${key.repeat(8)}-0000-4000-8000-000000000000`, short_id: key.repeat(8), project_name: 'fixture-web',
  environment: 'production', url: `https://${key.repeat(8)}.fixture-web.pages.dev`,
  created_on: new Date(now - 100 * day).toISOString(),
  latest_stage: { name: 'deploy', status: 'success', ended_on: new Date(now - age * day).toISOString() }, ...extra
})
const cloud = canonical => ({ name: 'fixture-web', canonical_deployment: canonical })
const page = (result, index = 1, total = 1) => ({ result, resultInfo: { page: index, total_pages: total, per_page: 25 } })
const record = (name, values) => ({ roots: [`/_nuxt/${name}`], assets: Object.entries(values).map(([path, bytes]) => ({ path, sha256: hash(bytes) })) })

function staged(t) {
  const directory = mkdtempSync(join(tmpdir(), 'powersync-retain-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const files = { '/_nuxt/worker-v4.js': 'export const load = () => import("./current-HASH.js")', '/_nuxt/current-HASH.js': 'export const current = true' }
  const put = (path, bytes) => { const file = join(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes) }
  for (const [path, bytes] of Object.entries(files)) put(path, bytes)
  put('/_nuxt/powersync-assets.json', JSON.stringify(record('worker-v4.js', files)))
  put('/_headers', '/_nuxt/*\n  Cache-Control: public, max-age=31536000, immutable\n')
  put('/_routes.json', JSON.stringify({ version: 1, include: ['/*'], exclude: ['/_nuxt/*'] }))
  return { directory, files, put }
}

function staticFetch(snapshots) {
  return async (input, options) => {
    assert.equal(options.headers?.Authorization, undefined)
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    const url = new URL(input)
    const assets = snapshots[url.origin]
    const value = assets?.[url.pathname]
    if (value instanceof Response) return value.clone()
    if (value === undefined) return new Response('missing', { status: 404 })
    const type = url.pathname.endsWith('.json') ? 'application/json' : url.pathname.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
    return new Response(value, { headers: { 'content-type': type } })
  }
}
function runtime(dep, bytes = 'export const value = 1') {
  const files = { '/_nuxt/worker-v4.js': `export const load = () => import("./${dep}")`, [`/_nuxt/${dep}`]: bytes }
  return { ...files, '/_nuxt/powersync-assets.json': JSON.stringify(record('worker-v4.js', files)) }
}

// Removing the boundary predecessor would drop a months-old runtime replaced yesterday.
test('history paginates and uses successful completion for the seven-day window, predecessor and old canonical', async () => {
  const a = snapshot('a', 100), b = snapshot('b', 8), c = snapshot('c', 6), d = snapshot('d', 1)
  const failed = snapshot('e', 0, { latest_stage: { name: 'deploy', status: 'failure', ended_on: new Date(now).toISOString() } })
  const calls = []
  const result = await discoverSnapshots({ project: cloud(a), now, readPage: async number => { calls.push(number); return number === 1 ? page([d, failed], 1, 3) : number === 2 ? page([c, b], 2, 3) : page([a], 3, 3) } })
  assert.deepEqual(calls, [1, 2, 3])
  assert.deepEqual(new Set(result.selected.map(item => item.id)), new Set([a.id, b.id, c.id, d.id]))
  assert.equal(result.complete, true)
  assert.equal(result.expired.length, 0)
})

test('a failed later history page preserves discovered snapshots and reports unknown coverage', async () => {
  const a = snapshot('a', 100), b = snapshot('b', 1), warnings = []
  const result = await discoverSnapshots({ project: cloud(a), now, onWarning: warning => warnings.push(warning), readPage: async number => {
    if (number === 2) throw new HistoricalRecoveryError('history-unavailable')
    return page([b], 1, 2)
  } })
  assert.equal(result.complete, false)
  assert.deepEqual(new Set(result.selected.map(item => item.id)), new Set([a.id, b.id]))
  assert.equal(warnings[0].category, 'history-unavailable')
})

test('history failure must not swallow programming errors or cancellation', async () => {
  await assert.rejects(discoverSnapshots({ project: cloud(null), now, readPage: async () => { throw new TypeError('bug') } }), /bug/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(discoverSnapshots({ project: cloud(null), now, signal: controller.signal, readPage: async () => { throw new HistoricalRecoveryError('history-unavailable') } }), { name: 'AbortError' })
})

test('malformed historical stage lists warn without blocking a healthy release', async t => {
  const { directory } = staged(t)
  const a = snapshot('a', 1, { latest_stage: { name: 'build', status: 'success' }, stages: {} })
  const report = await preparePowerSyncRetention({ directory, project: cloud(a), now, readPage: async () => page([a]) })
  assert.equal(report.coverage, 'unknown')
  assert.ok(report.warnings.some(warning => warning.category === 'invalid-history-entry'))
})

test('three releases retain multiple original versions, deduplicate, keep the current entry and do not renew expired carry-forward files', async t => {
  const { directory, files } = staged(t)
  const a = snapshot('a', 9), b = snapshot('b', 6), c = snapshot('c', 1), expired = snapshot('d', 20)
  const shared = 'export const shared = true'
  const aFiles = runtime('A-HASH.js', shared), bFiles = runtime('B-HASH.js', shared), cFiles = runtime('B-HASH.js', shared)
  // A copied old file is deliberately absent from this snapshot's current-only index.
  cFiles['/_nuxt/expired-HASH.js'] = 'export const expired = true'
  const report = await preparePowerSyncRetention({ directory, project: cloud(c), now, readPage: async () => page([c, b, a, expired]), fetchImpl: staticFetch({ [a.url]: aFiles, [b.url]: bFiles, [c.url]: cFiles }) })
  assert.equal(readFileSync(join(directory, '_nuxt/A-HASH.js'), 'utf8'), shared)
  assert.equal(readFileSync(join(directory, '_nuxt/B-HASH.js'), 'utf8'), shared)
  assert.equal(readFileSync(join(directory, '_nuxt/worker-v4.js'), 'utf8'), files['/_nuxt/worker-v4.js'])
  assert.equal(existsSync(join(directory, '_nuxt/expired-HASH.js')), false)
  assert.equal(report.retained.count, 2)
  assert.equal(report.expired.runtimes, 1)
  assert.equal(JSON.parse(readFileSync(join(directory, '_nuxt/powersync-assets.json'))).assets.length, 2)
  assert.equal(report.warnings.length, 0)
})

test('unrecoverable HTML and digest mismatch warn while verified sibling assets still merge', async t => {
  const { directory } = staged(t)
  const a = snapshot('a', 1)
  const data = runtime('good-HASH.js')
  data['/_nuxt/worker-v4.js'] += '; export const broken = () => Promise.all([import("./html-HASH.js"), import("./wrong-HASH.js")])'
  const index = JSON.parse(data['/_nuxt/powersync-assets.json'])
  index.assets.find(asset => asset.path === '/_nuxt/worker-v4.js').sha256 = hash(data['/_nuxt/worker-v4.js'])
  index.assets.push({ path: '/_nuxt/html-HASH.js', sha256: hash('export const html = false') }, { path: '/_nuxt/wrong-HASH.js', sha256: hash('export const wrong = false') })
  data['/_nuxt/powersync-assets.json'] = JSON.stringify(index)
  data['/_nuxt/html-HASH.js'] = new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' } })
  data['/_nuxt/wrong-HASH.js'] = 'export const different = true'
  const report = await preparePowerSyncRetention({ directory, project: cloud(a), now, readPage: async () => page([a]), fetchImpl: staticFetch({ [a.url]: data }) })
  assert.equal(existsSync(join(directory, '_nuxt/good-HASH.js')), true)
  assert.equal(existsSync(join(directory, '_nuxt/html-HASH.js')), false)
  assert.equal(existsSync(join(directory, '_nuxt/wrong-HASH.js')), false)
  assert.equal(report.coverage, 'partial')
  assert.ok(report.warnings.some(warning => warning.category === 'html-resource'))
  assert.ok(report.warnings.some(warning => warning.category === 'digest-mismatch'))
})

test('current bytes win conflicts and conflicting historical paths are omitted', async t => {
  const { directory, files } = staged(t)
  const a = snapshot('a', 1), b = snapshot('b', 2)
  const aFiles = runtime('conflict-HASH.js', 'export const version = 1'), bFiles = runtime('conflict-HASH.js', 'export const version = 2')
  aFiles['/_nuxt/worker-v4.js'] += '; export const second = () => import("./current-HASH.js")'
  const idx = JSON.parse(aFiles['/_nuxt/powersync-assets.json'])
  idx.assets.find(asset => asset.path === '/_nuxt/worker-v4.js').sha256 = hash(aFiles['/_nuxt/worker-v4.js'])
  idx.assets.push({ path: '/_nuxt/current-HASH.js', sha256: hash('export const wrong = true') })
  aFiles['/_nuxt/current-HASH.js'] = 'export const wrong = true'
  aFiles['/_nuxt/powersync-assets.json'] = JSON.stringify(idx)
  const report = await preparePowerSyncRetention({ directory, project: cloud(a), now, readPage: async () => page([a, b]), fetchImpl: staticFetch({ [a.url]: aFiles, [b.url]: bFiles }) })
  assert.equal(existsSync(join(directory, '_nuxt/conflict-HASH.js')), false)
  assert.equal(readFileSync(join(directory, '_nuxt/current-HASH.js'), 'utf8'), files['/_nuxt/current-HASH.js'])
  assert.equal(report.coverage, 'partial')
  assert.ok(report.warnings.some(warning => warning.category === 'historical-conflict'))
  assert.ok(report.warnings.some(warning => warning.category === 'current-conflict'))
})

test('missing legacy index bootstraps only verified original dependency bytes', async t => {
  const { directory } = staged(t)
  const a = snapshot('a', 1)
  const data = runtime('legacy-HASH.js')
  delete data['/_nuxt/powersync-assets.json']
  const report = await preparePowerSyncRetention({ directory, project: cloud(a), now, readPage: async () => page([a]), fetchImpl: staticFetch({ [a.url]: data }) })
  assert.equal(readFileSync(join(directory, '_nuxt/legacy-HASH.js'), 'utf8'), 'export const value = 1')
  assert.equal(report.legacyRuntimes, 1)
  assert.equal(report.coverage, 'complete')
})

test('historical indexes cannot retain valid chunks outside the Worker dependency graph', async t => {
  const { directory } = staged(t)
  const a = snapshot('a', 1)
  const data = runtime('worker-dependency-HASH.js')
  const unrelated = 'export const pageOnly = true'
  const index = JSON.parse(data['/_nuxt/powersync-assets.json'])
  index.assets.push({ path: '/_nuxt/page-HASH.js', sha256: hash(unrelated) })
  data['/_nuxt/page-HASH.js'] = unrelated
  data['/_nuxt/powersync-assets.json'] = JSON.stringify(index)
  const report = await preparePowerSyncRetention({ directory, project: cloud(a), now, readPage: async () => page([a]), fetchImpl: staticFetch({ [a.url]: data }) })
  assert.equal(existsSync(join(directory, '_nuxt/page-HASH.js')), false)
  assert.equal(existsSync(join(directory, '_nuxt/worker-dependency-HASH.js')), true)
  assert.equal(report.coverage, 'partial')
  assert.ok(report.warnings.some(warning => warning.category === 'unreferenced-resource'))
})

test('unavailable history allows the valid current build, but current corruption always rejects', async t => {
  const { directory, put } = staged(t)
  const options = { directory, project: cloud(null), now, readPage: async () => { throw new HistoricalRecoveryError('history-unavailable') } }
  const report = await preparePowerSyncRetention(options)
  assert.equal(report.coverage, 'unknown')
  assert.equal(report.retained.count, 0)
  assert.match(formatRetentionSummary(report), /unknown/)
  put('/_nuxt/current-HASH.js', '<!DOCTYPE html>')
  await assert.rejects(preparePowerSyncRetention(options), /asset|JavaScript|digest|HTML/i)
})

test('foreign snapshot URLs and malformed indexes never authorize external fetches or staging writes', async t => {
  const { directory } = staged(t)
  const a = snapshot('a', 1, { url: 'https://attacker.example.test/' })
  let fetches = 0
  const report = await preparePowerSyncRetention({ directory, project: cloud(a), now, readPage: async () => page([a]), fetchImpl: async () => { fetches++; assert.fail('must not fetch foreign origin') } })
  assert.equal(fetches, 0)
  assert.equal(report.coverage, 'unknown')
  const b = snapshot('b', 1)
  const result = await preparePowerSyncRetention({ directory, project: cloud(b), now, readPage: async () => page([b]), fetchImpl: staticFetch({ [b.url]: { '/_nuxt/powersync-assets.json': JSON.stringify({ roots: ['/_worker.js/index.js'], assets: [{ path: '/_worker.js/index.js', sha256: hash('export default {}') }] }) } }) })
  assert.equal(result.coverage, 'unknown')
  assert.equal(existsSync(join(directory, '_worker.js/index.js')), false)
})

test('expired snapshots do not renew a runtime merely because later deployments carried its files', async t => {
  const { directory } = staged(t)
  const a = snapshot('a', 20), b = snapshot('b', 8), c = snapshot('c', 1)
  const bFiles = runtime('B-HASH.js'), cFiles = runtime('C-HASH.js')
  bFiles['/_nuxt/A-HASH.js'] = 'export const old = true'
  cFiles['/_nuxt/A-HASH.js'] = 'export const old = true'
  const requested = []
  const fetcher = staticFetch({ [b.url]: bFiles, [c.url]: cFiles })
  const report = await preparePowerSyncRetention({ directory, project: cloud(c), now, readPage: async () => page([c, b, a]), fetchImpl: async (url, options) => { requested.push(url); return fetcher(url, options) } })
  assert.equal(report.expired.runtimes, 1)
  assert.equal(existsSync(join(directory, '_nuxt/A-HASH.js')), false)
  assert.equal(existsSync(join(directory, '_nuxt/B-HASH.js')), true)
  assert.ok(requested.every(url => !url.startsWith(a.url)))
})

test('republishing older behavior uses the same retention path and keeps newer dependencies', async t => {
  const { directory, put } = staged(t)
  const old = runtime('old-HASH.js', 'export const revision = "old"')
  for (const [path, value] of Object.entries(old)) put(path, value)
  const newer = snapshot('b', 1)
  const report = await preparePowerSyncRetention({ directory, project: cloud(newer), now, readPage: async () => page([newer]), fetchImpl: staticFetch({ [newer.url]: runtime('new-HASH.js', 'export const revision = "new"') }) })
  assert.equal(readFileSync(join(directory, '_nuxt/old-HASH.js'), 'utf8'), 'export const revision = "old"')
  assert.equal(readFileSync(join(directory, '_nuxt/new-HASH.js'), 'utf8'), 'export const revision = "new"')
  assert.equal(JSON.parse(readFileSync(join(directory, '_nuxt/powersync-assets.json'))).assets.some(asset => asset.path === '/_nuxt/new-HASH.js'), false)
  assert.match(readFileSync(join(directory, '_headers'), 'utf8'), /! Cache-Control/)
  assert.equal(report.coverage, 'complete')
})

test('an incomplete historical index warns instead of claiming a full recovery', async t => {
  const { directory } = staged(t)
  const a = snapshot('a', 1)
  const data = runtime('omitted-HASH.js')
  const index = JSON.parse(data['/_nuxt/powersync-assets.json'])
  index.assets = index.assets.filter(asset => asset.path !== '/_nuxt/omitted-HASH.js')
  data['/_nuxt/powersync-assets.json'] = JSON.stringify(index)
  const report = await preparePowerSyncRetention({ directory, project: cloud(a), now, readPage: async () => page([a]), fetchImpl: staticFetch({ [a.url]: data }) })
  assert.equal(report.coverage, 'partial')
  assert.equal(report.recoveredRuntimes, 0)
  assert.ok(report.warnings.some(warning => warning.path === '/_nuxt/omitted-HASH.js'))
})

test('a malformed or repeating history page cannot report complete discovery', async () => {
  for (const readPage of [async () => ({ result: null }), async () => page([null]), async () => ({ result: [snapshot('a', 1)], resultInfo: { total_pages: 5 } })]) {
    const report = await discoverSnapshots({ project: cloud(null), now, readPage })
    assert.equal(report.complete, false)
  }
})

test('static redirect, authorization, HTML and MIME failures remain warning-only and do not expose response contents', async t => {
  const cases = [
    new Response('private-response', { status: 302, headers: { location: 'https://elsewhere.example.test' } }),
    new Response('private-response', { status: 403 }),
    new Response('<!DOCTYPE html>private-response', { headers: { 'content-type': 'text/html' } }),
    new Response('export const value = 1', { headers: { 'content-type': 'text/plain' } })
  ]
  for (const result of cases) {
    const { directory } = staged(t)
    const a = snapshot('a', 1), data = runtime('old-HASH.js')
    data['/_nuxt/old-HASH.js'] = result
    const report = await preparePowerSyncRetention({ directory, project: cloud(a), now, readPage: async () => page([a]), fetchImpl: staticFetch({ [a.url]: data }) })
    assert.equal(existsSync(join(directory, '_nuxt/old-HASH.js')), false)
    assert.equal(report.coverage, 'partial')
    assert.doesNotMatch(formatRetentionSummary(report), /private-response|elsewhere/)
  }
})
