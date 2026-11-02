import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AssetValidationError, POWER_SYNC_INDEX_PATH, validateAssetIndex, validateAssetBytes, collectLegacyAssets, validateCurrentAssets, applyPowerSyncHeaders } from './powersync-assets.mjs'

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

async function readSnapshotAsset(origin, path, { fetchImpl, signal }) {
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
  if (path !== POWER_SYNC_INDEX_PATH && !(path.endsWith('.wasm') ? /^application\/wasm(?:;|$)/i.test(type) : /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i.test(type))) throw new AssetValidationError('invalid-content-type', path)
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

export async function preparePowerSyncRetention({ directory, project, readPage, fetchImpl = fetch, now = Date.now(), signal, onWarning = () => {} }) {
  const current = await validateCurrentAssets(directory)
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
  const retained = new Map()
  const ambiguous = new Set()
  const roots = new Set(current.index.roots)
  const coverage = new Map()
  let unknown = !history.complete
  let legacyRuntimes = 0
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
      continue
    }
    if (recovered.legacy) legacyRuntimes++
    coverage.set(snapshot.id, recovered.complete)
    for (const [path, bytes] of recovered.files) {
      const existing = current.files.get(path)
      if (existing) {
        if (!existing.equals(bytes) && !(current.index.roots.includes(path) && recovered.index.roots.includes(path))) {
          warnForSnapshot({ category: 'current-conflict', path })
          coverage.set(snapshot.id, false)
        }
        continue
      }
      if (ambiguous.has(path)) {
        warnForSnapshot({ category: 'historical-conflict', path })
        coverage.set(snapshot.id, false)
        continue
      }
      const previous = retained.get(path)
      if (previous && !previous.bytes.equals(bytes)) {
        retained.delete(path)
        ambiguous.add(path)
        coverage.set(snapshot.id, false)
        for (const owner of previous.owners) {
          coverage.set(owner, false)
          warn({ category: 'historical-conflict', path, deployment: owner })
        }
        warnForSnapshot({ category: 'historical-conflict', path })
        continue
      }
      // A current non-PowerSync asset is also authoritative; never overwrite it.
      let staged
      try { staged = await readFile(join(directory, path)) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (staged && !staged.equals(bytes)) {
        warnForSnapshot({ category: 'current-conflict', path })
        coverage.set(snapshot.id, false)
        continue
      }
      if (previous) previous.owners.add(snapshot.id)
      else retained.set(path, { bytes, owners: new Set([snapshot.id]), alreadyPresent: !!staged })
      if (recovered.index.roots.includes(path)) roots.add(path)
    }
  }
  let retainedCount = 0, retainedBytes = 0
  for (const [path, value] of retained) {
    if (value.alreadyPresent) continue
    const target = join(directory, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, value.bytes)
    retainedCount++
    retainedBytes += value.bytes.length
  }
  await applyPowerSyncHeaders(directory, [...roots].filter(path => current.files.has(path) || retained.has(path)))
  // Historical warnings may never excuse corruption of the new runtime.
  await validateCurrentAssets(directory)
  const report = {
    targetDays: 7,
    current: { count: current.files.size, bytes: [...current.files.values()].reduce((sum, bytes) => sum + bytes.length, 0) },
    retained: { count: retainedCount, bytes: retainedBytes },
    expired: { runtimes: history.expired.length, count: null, bytes: null },
    selectedRuntimes: history.selected.length, recoveredRuntimes: [...coverage.values()].filter(Boolean).length, legacyRuntimes,
    coverage: unknown ? 'unknown' : warnings.length ? 'partial' : 'complete', warnings
  }
  return report
}

const safe = value => String(value).replace(/[^a-zA-Z0-9_./-]/g, '_').slice(0, 240)
export function retentionWarning(warning) {
  const context = [warning.deployment && `deployment=${safe(warning.deployment)}`, warning.path && `path=${safe(warning.path)}`].filter(Boolean).join(' ')
  return `PowerSync history: ${safe(warning.category)}${context ? ` (${context})` : ''}; continuing with verified resources`
}

export function formatRetentionSummary(report) {
  const lines = [
    '## PowerSync Worker resource retention', '',
    `Target: ${report.targetDays} days after replacement. Historical coverage: **${report.coverage}**.`, '',
    '| Resources | Files | Bytes |', '| --- | ---: | ---: |',
    `| Current runtime | ${report.current.count} | ${report.current.bytes} |`,
    `| Added historical dependencies | ${report.retained.count} | ${report.retained.bytes} |`,
    '| Expired dependencies | unknown (not inventoried) | unknown (not downloaded) |', '',
    `Selected runtimes: ${report.selectedRuntimes}; fully recovered: ${report.recoveredRuntimes}; legacy inventories: ${report.legacyRuntimes}; expired snapshots: ${report.expired.runtimes}.`,
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
