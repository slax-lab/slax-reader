import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

// The parser belongs to the Web build, which already uses it for source checks.
const { parseSync } = createRequire(new URL('../apps/web/package.json', import.meta.url))('oxc-parser')
export const POWER_SYNC_INDEX_PATH = '/_nuxt/powersync-assets.json'
const assetOrigin = 'https://powersync.invalid'
const headerStart = '# PowerSync mutable assets'
const headerEnd = '# End PowerSync mutable assets'

export class AssetValidationError extends Error {
  constructor(category, assetPath = POWER_SYNC_INDEX_PATH) {
    super(`PowerSync asset ${category}: ${assetPath}`)
    this.name = 'AssetValidationError'
    this.category = category
    this.path = assetPath
  }
}

function assetPath(value) {
  if (typeof value !== 'string' || !/^\/_nuxt\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|mjs|wasm)$/.test(value)) {
    throw new AssetValidationError('invalid-path')
  }
  return value
}

export function validateAssetIndex(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'assets,roots'
    || !Array.isArray(value.roots) || !value.roots.length || !Array.isArray(value.assets)) {
    throw new AssetValidationError('invalid-index')
  }
  const roots = value.roots.map(assetPath)
  const paths = new Set()
  if (new Set(roots).size !== roots.length || roots.some(root => !/\.m?js$/.test(root))) throw new AssetValidationError('invalid-index')
  const assets = value.assets.map(asset => {
    if (!asset || typeof asset !== 'object' || Object.keys(asset).sort().join(',') !== 'path,sha256'
      || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new AssetValidationError('invalid-index')
    const normalized = assetPath(asset.path)
    if (paths.has(normalized)) throw new AssetValidationError('invalid-index', normalized)
    paths.add(normalized)
    return { path: normalized, sha256: asset.sha256 }
  })
  if (roots.some(root => !paths.has(root))) throw new AssetValidationError('invalid-index')
  return { roots, assets }
}

function parseJavaScript(bytes, name) {
  const source = new TextDecoder('utf-8', { fatal: true })
  let code
  try { code = source.decode(bytes) } catch { throw new AssetValidationError('invalid-js', name) }
  const parsed = parseSync(name, code, { sourceType: 'module' })
  if (parsed.errors.length) throw new AssetValidationError('invalid-js', name)
  return parsed.program
}

export function validateAssetBytes(name, bytes) {
  assetPath(name)
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new AssetValidationError('empty-resource', name)
  if (name.endsWith('.wasm')) {
    if (!WebAssembly.validate(bytes)) throw new AssetValidationError('invalid-wasm', name)
    return { dependencies: [], unresolved: false }
  }
  return inspectJavaScript(bytes, name)
}

function isImportMetaUrl(node) {
  return node?.type === 'MemberExpression' && !node.computed && node.property.name === 'url'
    && node.object.type === 'MetaProperty' && node.object.meta.name === 'import' && node.object.property.name === 'meta'
}

function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
}

function staticUrl(node, base) {
  const literal = staticString(node)
  if (literal !== undefined) return literal
  if (node?.type === 'MemberExpression' && !node.computed && node.property.name === 'href') return staticUrl(node.object, base)
  if (node?.type !== 'NewExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'URL') return
  const relative = staticUrl(node.arguments[0], base)
  const parent = isImportMetaUrl(node.arguments[1]) ? base : staticUrl(node.arguments[1], base)
  if (relative === undefined || parent === undefined) return
  try { return new URL(relative, parent).href } catch { return }
}

export function inspectJavaScript(bytes, name) {
  const program = parseJavaScript(bytes, name)
  const dependencies = new Set()
  let unresolved = false
  const base = new URL(name, assetOrigin).href
  const add = (reference, required = true) => {
    if (reference === undefined) { unresolved = true; return }
    if (reference.startsWith('data:')) return
    let resolved
    try { resolved = new URL(reference, base) } catch { unresolved = true; return }
    if (!required && !/\.(?:m?js|wasm)$/.test(resolved.pathname)) return
    if (resolved.origin !== assetOrigin || resolved.search || resolved.hash) { unresolved = true; return }
    try { dependencies.add(assetPath(resolved.pathname)) } catch (error) {
      if (!(error instanceof AssetValidationError)) throw error
      unresolved = true
    }
  }
  const stack = [program]
  while (stack.length) {
    const node = stack.pop()
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || (node.type === 'ExportNamedDeclaration' && node.source)) {
      add(staticString(node.source))
    } else if (node.type === 'ImportExpression') {
      add(staticString(node.source))
    } else if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL' && isImportMetaUrl(node.arguments[1])) {
      // Includes Emscripten's nested new URL(new URL(...).href, import.meta.url).
      add(staticUrl(node, base), false)
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') stack.push(child)
      } else if (value && typeof value === 'object' && typeof value.type === 'string') stack.push(value)
    }
  }
  return { dependencies: [...dependencies].sort(), unresolved }
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function indexFromFiles(roots, files) {
  return { roots: [...new Set(roots)].sort(), assets: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => ({ path: name, sha256: digest(bytes) })) }
}

async function readLocal(publicDir, name) {
  try { return await readFile(path.join(publicDir, assetPath(name))) } catch (error) {
    if (error.code === 'ENOENT') throw new AssetValidationError('missing-resource', name)
    throw error
  }
}

export async function collectLegacyAssets({ roots, readAsset, onWarning }) {
  const files = new Map()
  const visited = new Set()
  const pending = [...roots]
  let complete = true
  while (pending.length) {
    const name = assetPath(pending.shift())
    if (visited.has(name)) continue
    visited.add(name)
    try {
      const bytes = await readAsset(name)
      const result = validateAssetBytes(name, bytes)
      files.set(name, Buffer.from(bytes))
      pending.push(...result.dependencies)
      if (result.unresolved) throw new AssetValidationError('unsupported-dependency', name)
    } catch (error) {
      if (!(error instanceof AssetValidationError)) throw error
      complete = false
      onWarning({ path: error.path, category: error.category })
    }
  }
  return { index: indexFromFiles(roots, files), files, complete }
}

export async function generateAssetIndex(publicDir, roots, emittedAssets = []) {
  if (!roots.length) throw new AssetValidationError('missing-worker-roots')
  const result = await collectLegacyAssets({
    roots,
    readAsset: name => readLocal(publicDir, name),
    onWarning: warning => { throw new AssetValidationError(warning.category, warning.path) },
  })
  for (const name of emittedAssets) {
    if (!result.files.has(assetPath(name))) throw new AssetValidationError('incomplete-index', name)
  }
  const index = validateAssetIndex(result.index)
  await writeFile(path.join(publicDir, POWER_SYNC_INDEX_PATH), `${JSON.stringify(index, null, 2)}\n`)
  return index
}

export async function validateCurrentAssets(publicDir) {
  let raw
  try { raw = await readFile(path.join(publicDir, POWER_SYNC_INDEX_PATH), 'utf8') } catch (error) {
    if (error.code === 'ENOENT') throw new AssetValidationError('missing-index')
    throw error
  }
  let value
  try { value = JSON.parse(raw) } catch { throw new AssetValidationError('invalid-index') }
  const index = validateAssetIndex(value)
  const files = new Map()
  const dependencies = new Map()
  for (const asset of index.assets) {
    const bytes = await readLocal(publicDir, asset.path)
    dependencies.set(asset.path, validateAssetBytes(asset.path, bytes))
    if (digest(bytes) !== asset.sha256) throw new AssetValidationError('digest-mismatch', asset.path)
    files.set(asset.path, bytes)
  }
  const reachable = new Set()
  const pending = [...index.roots]
  while (pending.length) {
    const name = pending.shift()
    if (reachable.has(name)) continue
    const bytes = files.get(name)
    if (!bytes) throw new AssetValidationError('incomplete-index', name)
    reachable.add(name)
    const result = dependencies.get(name)
    if (result.unresolved) throw new AssetValidationError('unsupported-dependency', name)
    pending.push(...result.dependencies)
  }
  if (reachable.size !== files.size) throw new AssetValidationError('incomplete-index')
  return { index, files }
}

export async function applyPowerSyncHeaders(publicDir, roots) {
  const routes = JSON.parse(await readFile(path.join(publicDir, '_routes.json'), 'utf8'))
  if (!routes.exclude?.includes('/_nuxt/*')) throw new AssetValidationError('worker-assets-not-static')
  const filename = path.join(publicDir, '_headers')
  const existing = await readFile(filename, 'utf8')
  const original = existing.replace(new RegExp(`\\n?${headerStart}[\\s\\S]*?${headerEnd}\\n?`, 'g'), '').trimEnd()
  const paths = [...new Set([...roots.map(assetPath), POWER_SYNC_INDEX_PATH])].sort()
  const rules = paths.map(name => `${name}\n  ! Cache-Control\n  Cache-Control: no-cache, max-age=0, must-revalidate`).join('\n\n')
  await writeFile(filename, `${original}\n\n${headerStart}\n${rules}\n${headerEnd}\n`)
}

/** Record entry identities from each isolated Vite Worker build, then inspect final emitted bytes. */
export function createPowerSyncAssetBuild() {
  const roots = new Set()
  const emittedAssets = new Set()
  return {
    plugin() {
      return {
        name: 'slax-powersync-assets',
        generateBundle(_options, bundle) {
          const entries = Object.values(bundle).filter(output => output.type === 'chunk' && output.isEntry
            && output.facadeModuleId?.replaceAll('\\', '/').includes('/@powersync/web/'))
          for (const entry of entries) {
            roots.add(`/${entry.fileName}`)
            const pending = [entry.fileName]
            const visited = new Set()
            while (pending.length) {
              const filename = pending.shift()
              if (visited.has(filename)) continue
              visited.add(filename)
              const output = bundle[filename]
              if (!output) throw new AssetValidationError('missing-emitted-asset', `/${filename}`)
              if (/\.(?:m?js|wasm)$/.test(filename)) emittedAssets.add(`/${filename}`)
              if (output.type === 'chunk') pending.push(...output.imports, ...output.dynamicImports,
                ...(output.viteMetadata?.importedAssets ?? []))
            }
          }
        },
      }
    },
    async write(publicDir) {
      const index = await generateAssetIndex(publicDir, [...roots], [...emittedAssets])
      await applyPowerSyncHeaders(publicDir, index.roots)
      return index
    },
  }
}
