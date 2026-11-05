// Run after a production Web build: node apps/web/tests/fixtures/powersync-release/browser-check.mjs
// Uses disposable databases and local HTTP fixtures only. No credentials or remote publication.
import { applyPowerSyncHeaders,generateAssetIndex, validateCurrentAssets } from '../../../../../tooling/powersync-assets.mjs'
import { HistoricalRecoveryError, preparePowerSyncRetention } from '../../../../../tooling/powersync-retention.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm,writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename,dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const require = createRequire(join(web, 'package.json'))
const { chromium } = createRequire(require.resolve('@nuxt/test-utils'))('playwright-core')
const { build } = await import(require.resolve('vite'))
const { default: wasm } = await import(require.resolve('vite-plugin-wasm'))
const source = resolve(process.argv[2] || join(web, 'dist'))
const temporary = await mkdtemp(join(tmpdir(), 'powersync-release-browser-'))
const bytesHash = value => createHash('sha256').update(value).digest('hex')
const sourceIndex = (await validateCurrentAssets(source)).index
const originalLoader = sourceIndex.assets.find(asset => /\/wa-sqlite-async-[^/]+\.js$/.test(asset.path)).path
const originalWasm = sourceIndex.assets.find(asset => /\/wa-sqlite-async\.[^/]+\.wasm$/.test(asset.path)).path
const snapshots = new Map()

// Model actual resource changes by adding a valid WASM custom section and a JS
// comment, then assigning new content hashes. SQLite execution stays unchanged.
async function release(label) {
  const directory = join(temporary, label)
  await mkdir(join(directory, '_nuxt'), { recursive: true })
  const wasmBytes = Buffer.concat([await readFile(join(source, originalWasm)), Buffer.from([0, 2, 1, label.charCodeAt(0)])])
  const wasmPath = `/_nuxt/wa-sqlite-async.${bytesHash(wasmBytes).slice(0, 12)}.wasm`
  const loaderBytes = Buffer.from((await readFile(join(source, originalLoader), 'utf8')).replaceAll(basename(originalWasm), basename(wasmPath)) + `\n// fixture ${label}\n`)
  const loaderPath = `/_nuxt/wa-sqlite-async-${bytesHash(loaderBytes).slice(0, 12)}.js`
  for (const asset of sourceIndex.assets) {
    if ([originalLoader, originalWasm].includes(asset.path)) continue
    const input = await readFile(join(source, asset.path))
    const output = sourceIndex.roots.includes(asset.path) ? Buffer.from(input.toString().replaceAll(basename(originalLoader), basename(loaderPath))) : input
    await writeFile(join(directory, asset.path), output)
  }
  await writeFile(join(directory, wasmPath), wasmBytes)
  await writeFile(join(directory, loaderPath), loaderBytes)
  await writeFile(join(directory, '_headers'), '/_nuxt/*\n  Cache-Control: public, max-age=31536000, immutable\n')
  await writeFile(join(directory, '_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude: ['/_nuxt/*'] }))
  await generateAssetIndex(directory, sourceIndex.roots)
  await applyPowerSyncHeaders(directory, sourceIndex.roots)
  const short = label.charCodeAt(0).toString(16).repeat(4)
  const snapshot = { id: `${short}-0000-0000-0000-000000000000`, short_id: short, url: `https://${short}.fixture.pages.dev`, environment: 'production', latest_stage: { name: 'deploy', status: 'success', ended_on: `2026-11-0${label.charCodeAt(0) - 64}T00:00:00Z` } }
  snapshots.set(new URL(snapshot.url).origin, directory)
  return { directory, snapshot, loaderPath, wasmPath }
}

const contentType = name => name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.json') ? 'application/json' : 'text/javascript'
const fetchSnapshot = async (url, options) => {
  assert.equal(options.headers, undefined, 'API credentials must not reach snapshot assets')
  const target = new URL(url)
  const directory = snapshots.get(target.origin)
  assert(directory, 'Snapshots must use deployment-specific origins')
  try { return new Response(await readFile(join(directory, target.pathname)), { headers: { 'content-type': contentType(target.pathname) } }) }
  catch (error) { if (error.code !== 'ENOENT') throw error; return new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' } }) }
}
async function retain(current, previous, now = '2026-11-04T00:00:00Z') {
  return preparePowerSyncRetention({ directory: current.directory, project: { name: 'fixture', canonical_deployment: previous.at(-1).snapshot }, now: Date.parse(now), readPage: async () => ({ result: previous.map(item => item.snapshot), resultInfo: { page: 1, total_pages: 1 } }), fetchImpl: fetchSnapshot })
}

let browser, server
try {
  const a = await release('A'), b = await release('B'), c = await release('C')
  const clientEntry = join(temporary, 'client.js')
  await writeFile(clientEntry, `import { PowerSyncDatabase, Schema, Table, column } from ${JSON.stringify(require.resolve('@powersync/web'))};
    const filename='release-fixture.db';
    const schema=new Schema({notes:new Table({body:column.text})});
    let db, held;
    window.fixture={
      hold(){held=new SharedWorker('/_nuxt/worker-v4.js',{name:'shared-powersync-'+filename,type:'module'});held.port.start();},
      async init(){db=new PowerSyncDatabase({schema,database:{dbFilename:filename,useWebWorker:true,enableMultiTabs:true,worker:location.origin+'/_nuxt/worker-v4.js'}});await db.init();return true;},
      async put(id,body){await db.execute('INSERT OR REPLACE INTO notes(id, body) VALUES (?, ?)',[id,body]);},
      async rows(){return db.getAll('SELECT id, body FROM notes ORDER BY id');},
      async pending(){return (await db.getCrudBatch())?.crud.map(row=>({id:row.id,op:row.op,table:row.table}));},
      async close(){await db.close();}
    };
  `)
  const clientDir = join(temporary, 'client')
  await build({ configFile: false, root: web, logLevel: 'error', plugins: [wasm()], worker: { format: 'es', plugins: () => [wasm()] }, build: { target: 'es2022', outDir: clientDir, emptyOutDir: true, lib: { entry: clientEntry, formats: ['es'], fileName: () => 'client.js' } } })
  let active = a.directory
  const requests = []
  server = createServer(async (request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname
    requests.push(name)
    if (name === '/') {
      response.setHeader('content-type', 'text/html')
      return response.end('<!DOCTYPE html><title>PowerSync release fixture</title><script type="module" src="/client.js"></script>')
    }
    try {
      const bytes = await readFile(join(name.startsWith('/_nuxt/') ? active : clientDir, name))
      response.setHeader('content-type', contentType(name))
      response.setHeader('cache-control', name === '/_nuxt/worker-v4.js' || name.endsWith('powersync-assets.json') ? 'no-cache, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable')
      response.end(bytes)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      response.setHeader('content-type', 'text/html')
      response.end('<!DOCTYPE html><p>Missing asset fallback</p>')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.waitForFunction(() => window.fixture)
  await page.evaluate(() => window.fixture.hold())
  await page.waitForTimeout(500)
  assert(requests.includes('/_nuxt/worker-v4.js'))
  assert(!requests.includes(a.loaderPath), 'Old SQLite loading must remain deferred')
  assert(!requests.includes(a.wasmPath), 'Old WASM loading must remain deferred')
  const bReport = await retain(b, [a])
  active = b.directory
  const cReport = await retain(c, [a, b])
  active = c.directory
  assert.equal(await page.evaluate(() => window.fixture.init()), true)
  assert(requests.includes(a.loaderPath), 'A must fetch its original JS after C publication')
  assert(requests.includes(a.wasmPath), 'A must fetch its original WASM after C publication')
  for (const name of [a.loaderPath, a.wasmPath, b.loaderPath, b.wasmPath]) {
    assert.equal(bytesHash(Buffer.from(await (await fetch(origin + name)).arrayBuffer())), bytesHash(await readFile(join(name === b.loaderPath || name === b.wasmPath ? b.directory : a.directory, name))))
  }
  await page.evaluate(() => window.fixture.put('one', 'pending before suspension'))
  const pending = await page.evaluate(() => window.fixture.pending())
  assert.deepEqual(pending, [{ id: 'one', op: 'PUT', table: 'notes' }])
  const tab = await context.newPage()
  await tab.goto(origin)
  await tab.waitForFunction(() => window.fixture)
  await tab.evaluate(() => window.fixture.init())
  assert.deepEqual(await tab.evaluate(() => window.fixture.rows()), [{ id: 'one', body: 'pending before suspension' }])
  const cdp = await context.newCDPSession(page)
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' })
  await tab.evaluate(() => window.fixture.put('two', 'written in second tab'))
  await cdp.send('Page.setWebLifecycleState', { state: 'active' })
  assert.equal((await page.evaluate(() => window.fixture.rows())).length, 2)
  assert.equal((await page.evaluate(() => window.fixture.pending())).length, 2)
  await page.evaluate(() => window.fixture.close())
  await tab.evaluate(() => window.fixture.close())
  await page.evaluate(() => window.fixture.init())
  assert.equal((await page.evaluate(() => window.fixture.rows())).length, 2)
  assert.equal((await page.evaluate(() => window.fixture.pending())).length, 2)
  assert(!requests.includes('/_nuxt/powersync-assets.json'), 'Startup must not request the release index')
  const d = await release('D')
  const expiryReport = await retain(d, [a, b, c], '2026-11-12T00:00:00Z')
  active = d.directory
  assert.match(await (await fetch(origin + a.loaderPath)).text(), /<!DOCTYPE html>/)
  assert.match(await (await fetch(origin + b.loaderPath)).text(), /<!DOCTYPE html>/)
  assert.equal(bytesHash(Buffer.from(await (await fetch(origin + c.wasmPath)).arrayBuffer())), bytesHash(await readFile(join(c.directory, c.wasmPath))))
  assert.equal(expiryReport.selectedRuntimes, 1, 'Only old-but-active C remains eligible; carried A/B must expire')
  const rollback = { ...a, directory: join(temporary, 'rollback') }
  await cp(a.directory, rollback.directory, { recursive: true })
  const rollbackReport = await retain(rollback, [b, c])
  active = rollback.directory
  assert.equal(bytesHash(Buffer.from(await (await fetch(origin + c.wasmPath)).arrayBuffer())), bytesHash(await readFile(join(c.directory, c.wasmPath))))
  const e = await release('E')
  const unavailableReport = await preparePowerSyncRetention({ directory: e.directory, project: { name: 'fixture' }, readPage: async () => { throw new HistoricalRecoveryError('history-unavailable') } })
  assert.equal(unavailableReport.coverage, 'unknown')
  assert.equal(unavailableReport.retained.count, 0)
  active = e.directory
  assert(WebAssembly.validate(await (await fetch(origin + e.wasmPath)).arrayBuffer()))
  await rm(join(e.directory, e.wasmPath))
  await assert.rejects(() => retain(e, [a]), /missing-resource/)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'passed', scenarios: ['A loaded before B/C; A JS/WASM deferred until C', 'both earlier releases retained with matching bytes', 'two tabs share real SQLite writes', 'freeze/resume preserves writes', 'close/reopen preserves pending CRUD', 'no runtime index request', 'expiry does not renew carried files; old active runtime retained', 'managed rollback preserves newer runtime', 'unavailable history continues; current defects block'], b: bReport, c: cReport, expiry: expiryReport, rollback: rollbackReport, unavailable: unavailableReport }, null, 2))
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
