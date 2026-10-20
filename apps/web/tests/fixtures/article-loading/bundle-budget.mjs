// Compare production client entry + article route preloads and static imports.
// Run: node apps/web/tests/fixtures/article-loading/bundle-budget.mjs BASE_DIST NEW_DIST
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { parseSync } from 'oxc-parser'

function closure(directory) {
  const root = resolve(directory)
  const html = readFileSync(resolve(root, 'login.html'), 'utf8')
  const entry = html.match(/"#entry":"\/_nuxt\/([^"?]+)"/)?.[1]
  if (!entry) throw new Error('Missing Nuxt client entry')
  const entryPath = resolve(root, '_nuxt', entry)
  const code = readFileSync(entryPath, 'utf8')
  const route = code.match(/name\s*:\s*["']b-id["'][\s\S]{0,300}?component\s*:\s*\(\)\s*=>\s*(?:__vitePreload|\w+)\(\(\)\s*=>\s*import\("\.\/([^"]+)"\)[\s\S]*?__vite__mapDeps\(\[([^\]]+)\]\)/)
  const mapped = code.match(/m\.f\s*\|\|\s*\(m\.f\s*=\s*(\[[^\]]+\])/)
  if (!route || !mapped) throw new Error('Missing article route preload graph; update the probe for this bundler format')
  const dependencies = JSON.parse(mapped[1])
  const pending = [entryPath, resolve(root, '_nuxt', route[1]), ...route[2].split(',').map(index => resolve(root, '_nuxt', dependencies[Number(index)]))]
  for (const match of html.matchAll(/<link[^>]+href="\/_nuxt\/([^"?]+\.css)"/g)) pending.push(resolve(root, '_nuxt', match[1]))
  const seen = new Set()
  const result = { raw: 0, gzip: 0, brotli: 0, files: [] }
  while (pending.length) {
    const path = pending.pop()
    if (seen.has(path)) continue
    if (!path.startsWith(root + '/')) throw new Error('Dependency outside build')
    seen.add(path)
    const bytes = readFileSync(path)
    result.raw += bytes.length
    result.gzip += gzipSync(bytes, { level: 9 }).length
    result.brotli += brotliCompressSync(bytes).length
    result.files.push(path.slice(root.length + 1))
    if (!path.endsWith('.js')) continue
    const { module, errors } = parseSync(path, bytes.toString())
    if (errors.length) throw new Error('Cannot parse built chunk ' + path)
    const requests = module.staticImports.map(item => item.moduleRequest.value)
    for (const item of module.staticExports) for (const exportEntry of item.entries) {
      if (exportEntry.moduleRequest) requests.push(exportEntry.moduleRequest.value)
    }
    for (const request of requests) {
      if (request.startsWith('.')) pending.push(resolve(dirname(path), request))
      else throw new Error('Unexpected unresolved import ' + request)
    }
  }
  result.files.sort()
  return result
}

if (process.argv.length !== 4) throw new Error('Supply baseline and integrated dist directories')
const before = closure(process.argv[2])
const after = closure(process.argv[3])
const delta = Object.fromEntries(['raw', 'gzip', 'brotli'].map(key => [key, after[key] - before[key]]))
console.log(JSON.stringify({ before, after, delta, gzipCeiling: 50 * 1024, pass: delta.gzip <= 50 * 1024 }, null, 2))
if (delta.gzip > 50 * 1024) process.exitCode = 1
