import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AssetValidationError, POWER_SYNC_INDEX_PATH, validateAssetIndex, validateAssetBytes, collectLegacyAssets, validateCurrentAssets, applyPowerSyncHeaders } from './powersync-assets.mjs'
import { acceptsContentType, BUILD_ASSETS_INDEX_PATH, validateBuildAssetsIndex } from './build-assets.mjs'

const windowMs = 7 * 24 * 60 * 60_000
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export class HistoricalRecoveryError extends Error {
  constructor(category) { super(category); this.category = category }
}

function snapshotMetadata(value, projectName) {
  if (!value || !['production', 'preview'].includes(value.environment)) throw new HistoricalRecoveryError('invalid-history-entry')
  if (value.environment !== 'production' || value.is_skipped) return null
  if (!value.latest_stage || typeof value.latest_stage.name !== 'string' || typeof value.latest_stage.status !== 'string') throw new HistoricalRecoveryError('invalid-history-entry')
  if (value.stages !== undefined && !Array.isArray(value.stages)) throw new HistoricalRecoveryError('invalid-history-entry')
  if (value.latest_stage.name !== 'deploy' && value.stages === undefined) throw new HistoricalRecoveryError('invalid-history-entry')
  const stage = value.latest_stage.name === 'deploy' ? value.latest_stage : (Array.isArray(value.stages) ? value.stages.find(item => item?.name === 'deploy') : undefined)
  if (stage?.status !== 'success') return null
  const completed = typeof stage.ended_on === 'string' ? Date.parse(stage.ended_on) : NaN
  if (!idPattern.test(value.id) || !Number.isFinite(completed) || (value.project_name && value.project_name !== projectName)) throw new HistoricalRecoveryError('invalid-history-entry')
  return { id: value.id, url: value.url, shortId: value.short_id, completed }
}

// Pages orders by creation, while retention is based on successful publication.
// Read every result page before selecting the boundary predecessor.
export async function discoverSnapshots({ project, readPage, now = Date.now(), signal, onWarning = () => {} }) {
  const records = new Map()
  let complete = true
  const add = value => {
    try {
      const entry = snapshotMetadata(value, project.name)
      if (entry) records.set(entry.id, entry)
      return entry
    } catch (error) {
      if (!(error instanceof HistoricalRecoveryError)) throw error
      complete = false
      onWarning({ category: error.category })
      return null
    }
  }
  const canonical = project.canonical_deployment ? add(project.canonical_deployment) : null
  const seenIds = new Set()
  for (let number = 1; ; number++) {
    signal?.throwIfAborted()
    let data
    try { data = await readPage(number) }
    catch (error) {
      signal?.throwIfAborted()
      if (!(error instanceof HistoricalRecoveryError)) throw error
      complete = false
      onWarning({ category: error.category })
      break
    }
    const { result, resultInfo } = data || {}
    if (!Array.isArray(result) || (resultInfo?.page !== undefined && resultInfo.page !== number) || (resultInfo?.total_pages !== undefined && (!Number.isSafeInteger(resultInfo.total_pages) || resultInfo.total_pages < 0))) {
      complete = false
      onWarning({ category: 'invalid-history-page' })
      break
    }
    const before = seenIds.size
    for (const item of result) {
      add(item)
      if (typeof item?.id === 'string') seenIds.add(item.id)
    }
    if (resultInfo?.total_pages !== undefined ? number >= resultInfo.total_pages : result.length === 0) break
    // An API that repeats pages must not keep a release waiting indefinitely.
    if (number > 1 && result.length > 0 && seenIds.size === before) {
      complete = false
      onWarning({ category: 'repeated-history-page' })
      break
    }
  }
  const ordered = [...records.values()].sort((a, b) => b.completed - a.completed || a.id.localeCompare(b.id))
  const cutoff = now - windowMs
  const selected = ordered.filter(item => item.completed >= cutoff)
  const predecessor = ordered.find(item => item.completed < cutoff)
  for (const item of [predecessor, canonical]) if (item && !selected.some(entry => entry.id === item.id)) selected.push(item)
  return { selected, expired: ordered.filter(item => !selected.some(chosen => chosen.id === item.id)), complete }
}

function snapshotOrigin(snapshot, projectName) {
  let url
  try { url = new URL(snapshot.url) } catch { throw new HistoricalRecoveryError('invalid-snapshot-url') }
  const suffix = `.${projectName}.pages.dev`
  const label = url.hostname.slice(0, -suffix.length)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' || !url.hostname.endsWith(suffix) || !/^[a-f0-9]{8,32}$/.test(label) || (snapshot.shortId && label !== snapshot.shortId)) throw new HistoricalRecoveryError('invalid-snapshot-url')
  return url.origin
}

async function readSnapshotAsset(origin, path, { fetchImpl, signal }, acceptsType) {
  signal?.throwIfAborted()
  let response, bytes
  try {
    response = await fetchImpl(new URL(path, origin).href, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
    if (response.ok && !response.redirected) bytes = Buffer.from(await response.arrayBuffer())
  } catch {
    signal?.throwIfAborted()
    throw new AssetValidationError('download-unavailable', path)
  }
  if (!response.ok || response.redirected) throw new AssetValidationError(response.status === 404 ? 'missing-resource' : 'download-unavailable', path)
  const type = response.headers.get('content-type') || ''
  if (/text\/html/i.test(type) || /^\s*<!doctype|^\s*<html/i.test(bytes.toString('utf8', 0, 100))) throw new AssetValidationError('html-resource', path)
  if (acceptsType) {
    if (!acceptsType(type)) throw new AssetValidationError('invalid-content-type', path)
  } else if (path !== POWER_SYNC_INDEX_PATH && !(path.endsWith('.wasm') ? /^application\/wasm(?:;|$)/i.test(type) : /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i.test(type))) throw new AssetValidationError('invalid-content-type', path)
  return bytes
}

async function recoverSnapshot(snapshot, projectName, options) {
  const origin = snapshotOrigin(snapshot, projectName)
  const readAsset = path => readSnapshotAsset(origin, path, options)
  let indexBytes
  try { indexBytes = await readAsset(POWER_SYNC_INDEX_PATH) }
  catch (error) {
    if (!(error instanceof AssetValidationError)) throw error
    if (!['missing-resource', 'html-resource'].includes(error.category)) throw error
    const legacy = await collectLegacyAssets({ roots: ['/_nuxt/worker-v4.js'], readAsset, onWarning: options.onWarning })
    return { ...legacy, legacy: true }
  }
  let value
  try { value = JSON.parse(indexBytes.toString('utf8')) } catch { throw new AssetValidationError('invalid-index', POWER_SYNC_INDEX_PATH) }
  const index = validateAssetIndex(value)
  const files = new Map()
  let complete = true
  for (const asset of index.assets) {
    try {
      const bytes = await readAsset(asset.path)
      validateAssetBytes(asset.path, bytes)
      if (digest(bytes) !== asset.sha256) throw new AssetValidationError('digest-mismatch', asset.path)
      files.set(asset.path, bytes)
    } catch (error) {
      if (!(error instanceof AssetValidationError)) throw error
      complete = false
      options.onWarning({ category: error.category, path: asset.path })
    }
  }
  const graph = await collectLegacyAssets({ roots: index.roots, readAsset: async path => {
    if (!files.has(path)) throw new AssetValidationError('missing-resource', path)
    return files.get(path)
  }, onWarning: warning => { complete = false; options.onWarning(warning) } })
  for (const path of files.keys()) {
    if (!graph.files.has(path)) {
      complete = false
      options.onWarning({ category: 'unreferenced-resource', path })
    }
  }
  return { index, files: graph.files, complete: complete && graph.complete, legacy: false }
}

const BUILD_ASSET_CONCURRENCY = 8
const isJson = type => /^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(type)

// Recovers every file an earlier build listed under /_nuxt/, verified against the listed digest.
// A deployment published before the index existed yields a warning, not an inferred inventory.
async function recoverBuildAssets(snapshot, projectName, options) {
  const origin = snapshotOrigin(snapshot, projectName)
  let indexBytes
  try { indexBytes = await readSnapshotAsset(origin, BUILD_ASSETS_INDEX_PATH, options, isJson) }
  catch (error) {
    if (!(error instanceof AssetValidationError)) throw error
    // A 404 or the application shell means this deployment predates the index; an Access login page
    // arrives as a redirect and stays `download-unavailable`.
    if (['missing-resource', 'html-resource'].includes(error.category)) throw new AssetValidationError('missing-build-index', BUILD_ASSETS_INDEX_PATH)
    throw error
  }
  let value
  try { value = JSON.parse(indexBytes.toString('utf8')) } catch { throw new AssetValidationError('invalid-build-index', BUILD_ASSETS_INDEX_PATH) }
  const index = validateBuildAssetsIndex(value)
  const files = new Map()
  let complete = true
  const pending = [...index.assets]
  const worker = async () => {
    for (let asset = pending.shift(); asset; asset = pending.shift()) {
      options.signal?.throwIfAborted()
      try {
        const bytes = await readSnapshotAsset(origin, asset.path, options, type => acceptsContentType(asset.path, type))
        if (digest(bytes) !== asset.sha256) throw new AssetValidationError('digest-mismatch', asset.path)
        files.set(asset.path, bytes)
      } catch (error) {
        if (!(error instanceof AssetValidationError)) throw error
        complete = false
        options.onWarning({ category: error.category, path: asset.path })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BUILD_ASSET_CONCURRENCY, pending.length) }, worker))
  return { files, complete }
}

// The current build's own index is written by the build; a release without one carries no build assets.
async function readCurrentBuildIndex(directory) {
  let raw
  try { raw = await readFile(join(directory, BUILD_ASSETS_INDEX_PATH), 'utf8') } catch (error) {
    if (error.code === 'ENOENT') throw new AssetValidationError('missing-build-index', BUILD_ASSETS_INDEX_PATH)
    throw error
  }
  let value
  try { value = JSON.parse(raw) } catch { throw new AssetValidationError('invalid-build-index', BUILD_ASSETS_INDEX_PATH) }
  const index = validateBuildAssetsIndex(value)
  let bytes = 0
  for (const asset of index.assets) {
    const file = await readFile(join(directory, asset.path)).catch(error => { if (error.code === 'ENOENT') throw new AssetValidationError('missing-resource', asset.path); throw error })
    if (digest(file) !== asset.sha256) throw new AssetValidationError('digest-mismatch', asset.path)
    bytes += file.length
  }
  return { count: index.assets.length, bytes }
}

export async function preparePowerSyncRetention({ directory, project, readPage, fetchImpl = fetch, now = Date.now(), signal, onWarning = () => {} }) {
  const current = await validateCurrentAssets(directory)
  const currentBuild = await readCurrentBuildIndex(directory)
  const warnings = []
  const warned = new Set()
  const warn = warning => {
    const key = JSON.stringify(warning)
    if (warned.has(key)) return
    warned.add(key)
    warnings.push(warning)
    onWarning(warning)
  }
  const history = await discoverSnapshots({ project, readPage, now, signal, onWarning: warn })
  // One map for both kinds, so a file is never written twice and conflicts are judged across both.
  const retained = new Map()
  const ambiguous = new Set()
  const roots = new Set(current.index.roots)
  const coverage = new Map()
  const buildCoverage = new Map()
  let unknown = !history.complete
  let buildUnknown = !history.complete
  let legacyRuntimes = 0

  // Returns false when the candidate conflicts with the current build or another snapshot.
  const merge = async (snapshot, path, bytes, warnForSnapshot, kind) => {
    const existing = current.files.get(path)
    // An identical current file needs no copy and records nothing in `retained`.
    if (existing) {
      if (!existing.equals(bytes)) { warnForSnapshot({ category: 'current-conflict', path }); return false }
      return true
    }
    if (ambiguous.has(path)) { warnForSnapshot({ category: 'historical-conflict', path }); return false }
    const previous = retained.get(path)
    if (previous && !previous.bytes.equals(bytes)) {
      retained.delete(path)
      ambiguous.add(path)
      for (const owner of previous.owners) {
        if (previous.kinds.has('powersync')) coverage.set(owner, false)
        if (previous.kinds.has('build')) buildCoverage.set(owner, false)
        warn({ category: 'historical-conflict', path, deployment: owner, ...(previous.kinds.has('powersync') ? {} : { kind: 'build' }) })
      }
      warnForSnapshot({ category: 'historical-conflict', path })
      return false
    }
    // A current asset outside the PowerSync graph is also authoritative; never overwrite it.
    let staged
    try { staged = await readFile(join(directory, path)) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (staged && !staged.equals(bytes)) { warnForSnapshot({ category: 'current-conflict', path }); return false }
    const record = previous ?? { bytes, owners: new Set(), kinds: new Set(), alreadyPresent: !!staged }
    record.owners.add(snapshot.id)
    record.kinds.add(kind)
    retained.set(path, record)
    return true
  }

  for (const snapshot of history.selected) {
    signal?.throwIfAborted()
    const warnForSnapshot = warning => warn({ ...warning, deployment: snapshot.id })
    let recovered
    try {
      recovered = await recoverSnapshot(snapshot, project.name, { fetchImpl, signal, onWarning: warnForSnapshot })
    } catch (error) {
      signal?.throwIfAborted()
      if (!(error instanceof AssetValidationError) && !(error instanceof HistoricalRecoveryError)) throw error
      warnForSnapshot({ category: error.category, ...(error.path ? { path: error.path } : {}) })
      unknown = true
      coverage.set(snapshot.id, false)
      recovered = null
    }
    if (recovered) {
      if (recovered.legacy) legacyRuntimes++
      coverage.set(snapshot.id, recovered.complete)
      for (const [path, bytes] of recovered.files) {
        const existing = current.files.get(path)
        // A current file is never replaced. Worker entries keep their stable names across releases, so
        // a differing current entry is expected; the current entry wins either way.
        if (existing && (existing.equals(bytes) || (current.index.roots.includes(path) && recovered.index.roots.includes(path)))) continue
        if (!(await merge(snapshot, path, bytes, warnForSnapshot, 'powersync'))) { coverage.set(snapshot.id, false); continue }
        if (recovered.index.roots.includes(path)) roots.add(path)
      }
    }

    let build
    try {
      build = await recoverBuildAssets(snapshot, project.name, { fetchImpl, signal, onWarning: warning => warnForSnapshot({ ...warning, kind: 'build' }) })
    } catch (error) {
      signal?.throwIfAborted()
      if (!(error instanceof AssetValidationError) && !(error instanceof HistoricalRecoveryError)) throw error
      warnForSnapshot({ category: error.category, ...(error.path ? { path: error.path } : {}), kind: 'build' })
      buildUnknown = true
      buildCoverage.set(snapshot.id, false)
      continue
    }
    buildCoverage.set(snapshot.id, build.complete)
    for (const [path, bytes] of build.files) {
      // The PowerSync graph above already decided these paths for this snapshot.
      if (retained.get(path)?.kinds.has('powersync') && retained.get(path).owners.has(snapshot.id)) { retained.get(path).kinds.add('build'); continue }
      if (current.files.has(path) && current.files.get(path).equals(bytes)) continue
      // The current PowerSync Worker entry wins over an earlier one under the same stable name, as above.
      if (current.files.has(path) && current.index.roots.includes(path)) continue
      const warnForBuild = warning => warnForSnapshot({ ...warning, kind: 'build' })
      if (!(await merge(snapshot, path, bytes, warnForBuild, 'build'))) { buildCoverage.set(snapshot.id, false); continue }
    }
  }

  const totals = { powersync: { count: 0, bytes: 0 }, build: { count: 0, bytes: 0 } }
  for (const [path, value] of retained) {
    if (value.alreadyPresent) continue
    const target = join(directory, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, value.bytes)
    const bucket = value.kinds.has('powersync') ? totals.powersync : totals.build
    bucket.count++
    bucket.bytes += value.bytes.length
  }
  await applyPowerSyncHeaders(directory, [...roots].filter(path => current.files.has(path) || retained.has(path)))
  // Historical warnings may never excuse corruption of the new runtime.
  await validateCurrentAssets(directory)
  const powerSyncWarnings = warnings.filter(warning => !isBuildWarning(warning))
  const report = {
    targetDays: 7,
    current: { count: current.files.size, bytes: [...current.files.values()].reduce((sum, bytes) => sum + bytes.length, 0) },
    retained: totals.powersync,
    expired: { runtimes: history.expired.length, count: null, bytes: null },
    selectedRuntimes: history.selected.length, recoveredRuntimes: [...coverage.values()].filter(Boolean).length, legacyRuntimes,
    coverage: unknown ? 'unknown' : powerSyncWarnings.length ? 'partial' : 'complete', warnings,
    build: {
      current: currentBuild,
      retained: totals.build,
      recovered: [...buildCoverage.values()].filter(Boolean).length,
      coverage: buildUnknown ? 'unknown' : [...buildCoverage.values()].every(Boolean) ? 'complete' : 'partial'
    }
  }
  return report
}

// Build-asset warnings carry their own coverage and must not degrade the PowerSync coverage line.
const buildWarningCategories = new Set(['missing-build-index', 'invalid-build-index'])
const isBuildWarning = warning => buildWarningCategories.has(warning.category) || warning.kind === 'build'

const safe = value => String(value).replace(/[^a-zA-Z0-9_./-]/g, '_').slice(0, 240)
export function retentionWarning(warning) {
  const context = [warning.deployment && `deployment=${safe(warning.deployment)}`, warning.path && `path=${safe(warning.path)}`].filter(Boolean).join(' ')
  return `${warning.kind === 'build' || buildWarningCategories.has(warning.category) ? 'Build asset' : 'PowerSync'} history: ${safe(warning.category)}${context ? ` (${context})` : ''}; continuing with verified resources`
}

export function formatRetentionSummary(report) {
  const lines = [
    '## Web build resource retention', '',
    `Target: ${report.targetDays} days after replacement. Historical coverage: **${report.coverage}**.`, '',
    '| Resources | Files | Bytes |', '| --- | ---: | ---: |',
    `| Current runtime | ${report.current.count} | ${report.current.bytes} |`,
    `| Added historical dependencies | ${report.retained.count} | ${report.retained.bytes} |`,
    `| Current build assets | ${report.build.current.count} | ${report.build.current.bytes} |`,
    `| Added historical build assets | ${report.build.retained.count} | ${report.build.retained.bytes} |`,
    '| Expired dependencies | unknown (not inventoried) | unknown (not downloaded) |', '',
    `Selected runtimes: ${report.selectedRuntimes}; fully recovered: ${report.recoveredRuntimes}; legacy inventories: ${report.legacyRuntimes}; expired snapshots: ${report.expired.runtimes}.`,
    `Build asset coverage: **${report.build.coverage}**; deployments fully recovered: ${report.build.recovered}.`,
    'Expired files are omitted by rebuilding from current output and eligible original indexes. Carry-forward copies do not renew eligibility.', ''
  ]
  if (report.warnings.length) lines.push('Historical gaps:', ...report.warnings.map(warning => `- ${retentionWarning(warning)}`), '')
  return lines.join('\n')
}

export async function writeRetentionSummary(report, filename) {
  const summary = formatRetentionSummary(report)
  if (filename) await appendFile(filename, `${summary}\n`)
  return summary
}
