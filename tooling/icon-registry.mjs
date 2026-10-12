import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const MANIFEST_PATH = join(ROOT, 'apps/web/app/icons/registry.json')
const ASSET_DIR = join(ROOT, 'apps/web/app/assets/icons')
const GENERATED_PATH = join(ROOT, 'apps/web/app/icons/registry.generated.ts')
const SUPPORTED_SIZES = new Set([10, 12, 14, 16, 18, 20, 24, 32])
const ALLOWED_ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'polygon', 'polyline', 'line', 'circle', 'ellipse', 'defs', 'clippath', 'mask', 'symbol'])
const ALLOWED_PAINTS = new Set(['none', 'currentcolor', 'inherit', 'transparent'])
const ROOT_PRESENTATION_ATTRIBUTES = new Set([
  'color',
  'display',
  'fill',
  'fill-opacity',
  'fill-rule',
  'isolation',
  'opacity',
  'overflow',
  'paint-order',
  'pointer-events',
  'shape-rendering',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-rendering',
  'transform',
  'transform-origin',
  'vector-effect',
  'visibility'
])

const fail = message => {
  throw new Error(`icon registry: ${message}`)
}

const isContainedPath = (candidate, root) => candidate === root || candidate.startsWith(`${root}${sep}`)

/**
 * Resolve a manifest path through symlinks before checking its repository boundary.
 * The caller must only read the returned path after this check succeeds.
 */
export const resolveContainedPath = async (candidate, allowedRoot, label) => {
  let canonicalRoot
  let canonicalCandidate
  try {
    canonicalRoot = await realpath(allowedRoot)
    canonicalCandidate = await realpath(candidate)
  } catch {
    fail(`${label} does not exist: ${candidate}`)
  }
  if (!isContainedPath(canonicalCandidate, canonicalRoot)) {
    fail(`${label} resolves outside ${canonicalRoot}: ${canonicalCandidate}`)
  }
  return canonicalCandidate
}

export const hashSourceBytes = sourceBytes => createHash('sha256').update(sourceBytes).digest('hex')

const escapeXmlAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const parseSvg = (source, { paint, viewBox, kind }) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail('DOCTYPE and entity declarations are forbidden')
  if (/<\/?(?:script|style|foreignObject)\b/i.test(source)) fail('active SVG elements are forbidden')
  if (/<style\b|\burl\s*\(/i.test(source)) fail('style elements and CSS url() references are forbidden')
  if (/\bon[a-z-]+\s*=/i.test(source)) fail('event handler attributes are forbidden')

  const parserErrors = []
  const document = new DOMParser({ onError: (level, message) => parserErrors.push(`${level}: ${message}`) }).parseFromString(source, 'image/svg+xml')
  if (parserErrors.length) fail(`malformed XML: ${parserErrors.join('; ')}`)
  const root = document.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg') fail('source must contain exactly one root svg element')
  const sourceViewBox = root.getAttribute('viewBox') || undefined
  if ((kind === 'inline' || kind === 'mask') && !sourceViewBox) fail(`${kind} icons require a viewBox`)
  if (viewBox && sourceViewBox !== viewBox) fail(`manifest viewBox ${viewBox} does not match source viewBox ${sourceViewBox ?? '<missing>'}`)

  const elements = [root, ...Array.from(root.getElementsByTagName('*'))]
  for (const element of elements) {
    const name = element.nodeName.toLowerCase()
    if (!ALLOWED_ELEMENTS.has(name)) fail(`unsupported SVG element ${element.nodeName}`)
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index)
      if (!attribute) continue
      const attrName = attribute.name.toLowerCase()
      const attrValue = attribute.value
      if (/^on[a-z-]+$/i.test(attrName)) fail(`event handler ${attribute.name} is forbidden`)
      if (attrName === 'style') fail('inline style attributes are forbidden')
      if (attrName === 'href' || attrName === 'xlink:href') {
        if (!attrValue.startsWith('#')) fail(`non-fragment ${attribute.name} reference is forbidden`)
      }
      if (paint === 'currentColor' && (attrName === 'color' || attrName === 'fill' || attrName === 'stroke') && !ALLOWED_PAINTS.has(attrValue.toLowerCase())) {
        fail(`paint ${attrValue} is incompatible with currentColor policy`)
      }
    }
  }

  const serializer = new XMLSerializer()
  const innerGeometry = Array.from(root.childNodes)
    .map(node => serializer.serializeToString(node))
    .join('')
    .trim()
  const inheritedAttributes = []
  for (let index = 0; index < root.attributes.length; index += 1) {
    const attribute = root.attributes.item(index)
    if (!attribute) continue
    const name = attribute.name.toLowerCase()
    if (ROOT_PRESENTATION_ATTRIBUTES.has(name)) inheritedAttributes.push(`${name}="${escapeXmlAttribute(attribute.value)}"`)
  }
  const geometry = inheritedAttributes.length ? `<g ${inheritedAttributes.join(' ')}>${innerGeometry}</g>` : innerGeometry
  return { viewBox: sourceViewBox, geometry }
}

export const validateSvg = (source, metadata) => parseSvg(source, metadata)

export const validateManifestEntry = (key, entry) => {
  if (!entry || typeof entry !== 'object') fail(`${key} must be an object`)
  if (!['inline', 'mask', 'brand', 'raster'].includes(entry.kind)) fail(`${key} has an unsupported kind`)
  if (!entry.source || typeof entry.source !== 'string' || entry.source.startsWith('/') || entry.source.includes('..')) fail(`${key} must use a relative source path`)
  if ((entry.kind === 'inline' || entry.kind === 'mask') && extname(entry.source).toLowerCase() !== '.svg') fail(`${key} ${entry.kind} source must be an SVG`)
  if (!SUPPORTED_SIZES.has(entry.defaultSize)) fail(`${key} has unsupported defaultSize ${entry.defaultSize}`)
  if (entry.defaultSize === 10 && entry.compact !== true) fail(`${key} may use size 10 only when compact is true`)
  if (!['currentColor', 'fixed', 'mask-currentColor'].includes(entry.paint)) fail(`${key} has invalid paint policy`)
  if (!['decorative', 'control-labelled', 'standalone'].includes(entry.accessibility)) fail(`${key} has invalid accessibility mode`)
  if (entry.label !== undefined && typeof entry.label !== 'string') fail(`${key} label must be a string`)
  if (entry.label !== undefined && entry.accessibility !== 'standalone') fail(`${key} labels are only valid for standalone icons`)
  if (entry.accessibility === 'standalone' && entry.label !== undefined && entry.label.trim() === '') fail(`${key} standalone label must not be blank`)
  if (!entry.provenance || typeof entry.provenance.sourcePath !== 'string' || typeof entry.provenance.sourceCommit !== 'string') fail(`${key} must record source provenance`)
  if (entry.kind === 'inline' && entry.paint !== 'currentColor' && entry.paint !== 'fixed') fail(`${key} inline paint must be currentColor or fixed`)
  if (entry.kind === 'mask' && entry.paint !== 'mask-currentColor') fail(`${key} mask paint must be mask-currentColor`)
  if ((entry.kind === 'inline' || entry.kind === 'mask') && typeof entry.viewBox !== 'string') fail(`${key} must declare a viewBox`)
  if (entry.kind === 'brand' || entry.kind === 'raster') {
    if (entry.paint !== 'fixed') fail(`${key} ${entry.kind} paint must be fixed`)
    if (!Number.isFinite(entry.intrinsicWidth) || entry.intrinsicWidth <= 0 || !Number.isFinite(entry.intrinsicHeight) || entry.intrinsicHeight <= 0) {
      fail(`${key} ${entry.kind} entries require positive intrinsic dimensions`)
    }
  }
}

const loadManifest = async () => JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))

export const buildRegistry = async () => {
  const manifest = await loadManifest()
  if (manifest.version !== 1) fail(`unsupported manifest version ${manifest.version}`)
  if (typeof manifest.sourceCommit !== 'string' || !manifest.sourceCommit) fail('manifest must declare sourceCommit')
  if (!manifest.icons || typeof manifest.icons !== 'object' || Array.isArray(manifest.icons)) fail('manifest icons must be an object')
  const canonicalAssetRoot = await resolveContainedPath(ASSET_DIR, ROOT, 'icon asset root')

  const output = {}
  for (const [key, entry] of Object.entries(manifest.icons)) {
    validateManifestEntry(key, entry)
    if (entry.provenance.sourceCommit !== manifest.sourceCommit) fail(`${key} provenance sourceCommit must match the manifest sourceCommit`)
    const provenancePath = resolve(ROOT, entry.provenance.sourcePath.split('#', 1)[0])
    await resolveContainedPath(provenancePath, ROOT, `${key} provenance sourcePath`)
    const assetPath = resolve(ASSET_DIR, entry.source)
    const canonicalAssetPath = await resolveContainedPath(assetPath, canonicalAssetRoot, `${key} source`)
    const sourceBytes = await readFile(canonicalAssetPath)
    const source = extname(entry.source).toLowerCase() === '.svg' ? sourceBytes.toString('utf8') : null
    const parsed = source === null ? null : parseSvg(source, entry)
    const sourceHash = hashSourceBytes(sourceBytes)
    output[key] = {
      kind: entry.kind,
      source: entry.source,
      ...(parsed?.viewBox ? { viewBox: parsed.viewBox } : entry.viewBox ? { viewBox: entry.viewBox } : {}),
      ...(entry.intrinsicWidth ? { intrinsicWidth: entry.intrinsicWidth } : {}),
      ...(entry.intrinsicHeight ? { intrinsicHeight: entry.intrinsicHeight } : {}),
      defaultSize: entry.defaultSize,
      paint: entry.paint,
      accessibility: entry.accessibility,
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.kind === 'inline' && parsed?.geometry ? { geometry: parsed.geometry } : {}),
      sourceHash,
      provenance: entry.provenance
    }
  }
  return output
}

export const renderGeneratedRegistry = registry => {
  const imports = []
  const renderedRegistry = Object.fromEntries(
    Object.entries(registry).map(([key, entry]) => {
      if (entry.kind === 'inline') return [key, entry]
      const identifier = `iconAsset${imports.length}`
      const marker = `__${identifier}__`
      imports.push({ identifier, marker, source: entry.source })
      return [key, { ...entry, source: marker }]
    })
  )
  let serialized = JSON.stringify(renderedRegistry, null, 2)
  for (const { identifier, marker } of imports) serialized = serialized.replace(JSON.stringify(marker), identifier)
  const importBlock = imports.map(({ identifier, source }) => `import ${identifier} from ${JSON.stringify(`../assets/icons/${source}?url`)}`).join('\n')
  return `/* eslint-disable */\n/**\n * @generated by tooling/icon-registry.mjs; do not edit by hand.\n */\n${importBlock ? `${importBlock}\n\n` : ''}export const GENERATED_ICON_REGISTRY = ${serialized} as const\n`
}

const main = async () => {
  const mode = process.argv[2]
  if (mode !== '--check' && mode !== '--write') {
    console.error('Usage: node tooling/icon-registry.mjs --check|--write')
    process.exitCode = 2
    return
  }
  try {
    const registry = await buildRegistry()
    const generated = renderGeneratedRegistry(registry)
    if (mode === '--write') {
      await writeFile(GENERATED_PATH, generated)
      console.log(`icon registry generated: ${relative(ROOT, GENERATED_PATH)}`)
      return
    }
    const current = await readFile(GENERATED_PATH, 'utf8').catch(() => '')
    if (current !== generated) fail(`generated registry is stale; run pnpm icons:write`)
    console.log(`icon registry valid: ${Object.keys(registry).length} entries`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
