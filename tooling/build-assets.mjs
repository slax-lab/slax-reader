import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AssetValidationError, POWER_SYNC_INDEX_PATH } from './powersync-assets.mjs'

// Every content-hashed file the Web build emits under /_nuxt/, so a later release can recover the
// exact set an earlier deployment served to pages that are still open.
export const BUILD_ASSETS_INDEX_PATH = '/_nuxt/build-assets.json'
const extensions = ['js', 'mjs', 'css', 'map', 'wasm', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'json']
const pathPattern = new RegExp(`^/_nuxt/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\\.(?:${extensions.join('|')})$`)
// Mutable build metadata changes meaning per release and must reflect the current build only.
const excluded = new Set([BUILD_ASSETS_INDEX_PATH, POWER_SYNC_INDEX_PATH])
const excludedPrefixes = ['/_nuxt/builds/']

export function buildAssetPath(value) {
  if (typeof value !== 'string' || !pathPattern.test(value) || excluded.has(value) || excludedPrefixes.some(prefix => value.startsWith(prefix))) {
    throw new AssetValidationError('invalid-path', typeof value === 'string' ? value : undefined)
  }
  return value
}

const contentTypes = {
  js: /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i,
  mjs: /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i,
  css: /^text\/css(?:;|$)/i,
  map: /^(?:application\/(?:json|octet-stream)|text\/plain)(?:;|$)/i,
  wasm: /^application\/wasm(?:;|$)/i,
  json: /^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i,
  svg: /^image\/svg\+xml(?:;|$)/i
}

/** Whether a response content type is plausible for the file's extension; fonts and images vary by server. */
export function acceptsContentType(assetPath, type) {
  const extension = assetPath.slice(assetPath.lastIndexOf('.') + 1).toLowerCase()
  if (contentTypes[extension]) return contentTypes[extension].test(type)
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(extension)) return /^(?:font\/|application\/(?:font-|x-font-|vnd\.ms-fontobject|octet-stream))/i.test(type)
  return /^(?:image\/|application\/octet-stream)/i.test(type)
}

export function validateBuildAssetsIndex(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'assets' || !Array.isArray(value.assets)) {
    throw new AssetValidationError('invalid-build-index', BUILD_ASSETS_INDEX_PATH)
  }
  const seen = new Set()
  const assets = value.assets.map(asset => {
    if (!asset || typeof asset !== 'object' || Object.keys(asset).sort().join(',') !== 'path,sha256' || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new AssetValidationError('invalid-build-index', BUILD_ASSETS_INDEX_PATH)
    }
    let normalized
    try { normalized = buildAssetPath(asset.path) } catch { throw new AssetValidationError('invalid-build-index', BUILD_ASSETS_INDEX_PATH) }
    if (seen.has(normalized)) throw new AssetValidationError('invalid-build-index', BUILD_ASSETS_INDEX_PATH)
    seen.add(normalized)
    return { path: normalized, sha256: asset.sha256 }
  })
  return { assets }
}

async function walk(directory, prefix) {
  const out = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...await walk(path.join(directory, entry.name), relative))
    else if (entry.isFile()) out.push(relative)
  }
  return out
}

/** Write the build asset index for `<publicDir>/_nuxt/`; an unexpected emitted file fails the build. */
export async function writeBuildAssetsIndex(publicDir) {
  const files = (await walk(path.join(publicDir, '_nuxt'), '/_nuxt')).filter(file => !excluded.has(file) && !excludedPrefixes.some(prefix => file.startsWith(prefix)))
  const assets = []
  for (const file of files.sort()) {
    buildAssetPath(file)
    const bytes = await readFile(path.join(publicDir, file))
    if (!bytes.length) throw new AssetValidationError('empty-resource', file)
    assets.push({ path: file, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  const index = validateBuildAssetsIndex({ assets })
  await writeFile(path.join(publicDir, BUILD_ASSETS_INDEX_PATH), `${JSON.stringify(index)}\n`)
  return index
}
