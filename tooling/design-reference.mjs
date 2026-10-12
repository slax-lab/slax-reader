import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REFERENCE_ROOT = resolve(REPOSITORY_ROOT, 'docs/design/reference/slax-reader-design-system')
const MANIFEST_PATH = resolve(REFERENCE_ROOT, 'manifest.json')
const SNAPSHOT_ROOTS = ['slax-reader-design-system.html', 'SVG 切图汇总']

const SOURCE = {
  repository: 'https://github.com/unnoo/slax-reader-design-prototypes.git',
  commit: '04500203298547b8dd27a251748c2bf598af9d4d',
  objects: {
    designSystemHtmlBlob: '6e769fc62462319fefff54e5f7c9a18ae66dd72a',
    assetDirectoryTree: '7a88121ba07827b35a48fe06f6b8290c40e10da1'
  },
  importedAt: '2026-09-29',
  license: 'Apache-2.0',
  licenseStatus: 'Public repository inclusion approved by the Slax Reader maintainer; see SOURCE.md.'
}

const MEDIA_TYPES = {
  '.html': 'text/html',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

const ACTIVE_SVG_PATTERNS = [
  { label: 'DOCTYPE declaration', pattern: /<!DOCTYPE[\s>]/iu },
  { label: 'entity declaration', pattern: /<!ENTITY[\s>]/iu },
  { label: 'script element', pattern: /<script[\s>]/iu },
  { label: 'style element', pattern: /<style[\s>]/iu },
  { label: 'event handler attribute', pattern: /\son[a-z]+\s*=/iu },
  { label: 'foreignObject element', pattern: /<foreignObject[\s>]/iu },
  { label: 'CSS URL reference', pattern: /url\s*\(/iu },
  {
    label: 'non-fragment href reference',
    pattern: /\s(?:href|xlink:href)\s*=\s*["']\s*(?!#)[^"']+/iu
  }
]

async function listFiles(path) {
  const pathStat = await lstat(path)
  if (pathStat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${path}`)
  if (pathStat.isFile()) return [path]

  const entries = await readdir(path, { withFileTypes: true })
  const nested = await Promise.all(
    entries
      .sort((left, right) => compareText(left.name, right.name))
      .map(entry => listFiles(resolve(path, entry.name)))
  )
  return nested.flat()
}

function toPosixPath(path) {
  return path.split(sep).join('/')
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

async function buildManifest() {
  const files = (
    await Promise.all(SNAPSHOT_ROOTS.map(snapshotPath => listFiles(resolve(REFERENCE_ROOT, snapshotPath))))
  )
    .flat()
    .sort(compareText)

  const records = []
  for (const path of files) {
    const content = await readFile(path)
    const extension = extname(path).toLowerCase()
    const snapshotPath = toPosixPath(relative(REFERENCE_ROOT, path))

    if (!MEDIA_TYPES[extension]) throw new Error(`Unsupported reference file type: ${snapshotPath}`)

    if (extension === '.svg') validateSvg(snapshotPath, content.toString('utf8'))

    records.push({
      path: snapshotPath,
      mediaType: MEDIA_TYPES[extension],
      bytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex')
    })
  }

  await validateHtmlReferences(files)
  await validateSourceGitObjects()
  await validateSourceDocument()

  return {
    schemaVersion: 1,
    source: SOURCE,
    files: records
  }
}

async function validateSourceDocument() {
  const sourceDocument = await readFile(resolve(REFERENCE_ROOT, 'SOURCE.md'), 'utf8')
  const provenanceValues = [
    SOURCE.repository,
    SOURCE.commit,
    SOURCE.objects.designSystemHtmlBlob,
    SOURCE.objects.assetDirectoryTree,
    SOURCE.importedAt,
    SOURCE.license
  ]
  for (const value of provenanceValues) {
    if (!sourceDocument.includes(value)) throw new Error(`SOURCE.md is missing provenance value: ${value}`)
  }
}

async function validateSourceGitObjects() {
  const html = await readFile(resolve(REFERENCE_ROOT, 'slax-reader-design-system.html'))
  const htmlBlob = gitObjectId('blob', html)
  if (htmlBlob !== SOURCE.objects.designSystemHtmlBlob) {
    throw new Error(`Design-system HTML does not match source blob ${SOURCE.objects.designSystemHtmlBlob}`)
  }

  const assetRoot = resolve(REFERENCE_ROOT, 'SVG 切图汇总')
  const entries = (await readdir(assetRoot, { withFileTypes: true })).sort((left, right) =>
    Buffer.compare(Buffer.from(left.name), Buffer.from(right.name))
  )
  const treeEntries = []

  for (const entry of entries) {
    if (!entry.isFile()) throw new Error(`Source asset directory must remain flat: ${entry.name}`)
    const content = await readFile(resolve(assetRoot, entry.name))
    treeEntries.push(Buffer.from(`100644 ${entry.name}\0`), Buffer.from(gitObjectId('blob', content), 'hex'))
  }

  const assetTree = gitObjectId('tree', Buffer.concat(treeEntries))
  if (assetTree !== SOURCE.objects.assetDirectoryTree) {
    throw new Error(`Asset directory does not match source tree ${SOURCE.objects.assetDirectoryTree}`)
  }
}

function gitObjectId(type, content) {
  const header = Buffer.from(`${type} ${content.byteLength}\0`)
  return createHash('sha1').update(header).update(content).digest('hex')
}

function validateSvg(path, source) {
  if (!/<svg[\s>]/iu.test(source)) throw new Error(`SVG root is missing: ${path}`)
  if (!/\sviewBox\s*=/u.test(source)) throw new Error(`SVG viewBox is missing: ${path}`)

  for (const { label, pattern } of ACTIVE_SVG_PATTERNS) {
    if (pattern.test(source)) throw new Error(`Unsafe ${label} in ${path}`)
  }
}

async function validateHtmlReferences(files) {
  const knownPaths = new Set(files.map(path => toPosixPath(relative(REFERENCE_ROOT, path))))
  const htmlPaths = files.filter(path => extname(path).toLowerCase() === '.html')
  const assetPattern = /(?:src|href)=["']([^"']+)["']/giu

  for (const htmlPath of htmlPaths) {
    const html = await readFile(htmlPath, 'utf8')
    for (const match of html.matchAll(assetPattern)) {
      const target = match[1].split(/[?#]/u, 1)[0]
      if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/iu.test(target)) continue

      const targetPath = resolve(dirname(htmlPath), target)
      const snapshotPath = toPosixPath(relative(REFERENCE_ROOT, targetPath))
      if (snapshotPath.startsWith('../') || !knownPaths.has(snapshotPath)) {
        throw new Error(`Missing HTML reference target: ${snapshotPath}`)
      }
    }
  }
}

const manifest = await buildManifest()
const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`

if (process.argv.includes('--write')) {
  await writeFile(MANIFEST_PATH, serializedManifest, 'utf8')
  console.log(`Wrote ${toPosixPath(relative(REPOSITORY_ROOT, MANIFEST_PATH))}`)
} else {
  const committedManifest = await readFile(MANIFEST_PATH, 'utf8')
  if (committedManifest !== serializedManifest) {
    throw new Error('Design reference manifest is stale. Run: node tooling/design-reference.mjs --write')
  }
  console.log(`Validated ${manifest.files.length} design reference files`)
}
