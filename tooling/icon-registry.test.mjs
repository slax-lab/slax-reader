import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { buildRegistry, hashSourceBytes, renderGeneratedRegistry, resolveContainedPath, validateManifestEntry, validateSvg } from './icon-registry.mjs'

const metadata = { kind: 'inline', paint: 'currentColor', viewBox: '0 0 24 24' }
const execFileAsync = promisify(execFile)
const REPOSITORY_ROOT = new URL('..', import.meta.url)

test('builds the checked-in Web registry', async () => {
  const registry = await buildRegistry()
  assert.ok(Object.keys(registry).length >= 23)
  assert.equal(registry['bookmark.inbox'].viewBox, '0 0 18 18')
  assert.match(registry['bookmark.inbox'].geometry, /<path/)
  assert.match(registry['bookmark.inbox'].sourceHash, /^[a-f0-9]{64}$/)
  assert.equal(registry['fixture.mask'].kind, 'mask')
  assert.equal(registry['fixture.brand'].kind, 'brand')
  assert.equal(registry['fixture.raster'].kind, 'raster')
  assert.match(renderGeneratedRegistry(registry), /GENERATED_ICON_REGISTRY/)
})

test('hashes binary registry sources from their original bytes', async () => {
  const sourcePath = new URL('../apps/web/app/assets/icons/fixtures/raster.png', import.meta.url)
  const sourceBytes = await readFile(sourcePath)
  const registry = await buildRegistry()
  assert.equal(registry['fixture.raster'].sourceHash, hashSourceBytes(sourceBytes))
  assert.notEqual(hashSourceBytes(Buffer.from(sourceBytes.toString('utf8'))), registry['fixture.raster'].sourceHash)

  const mutatedBytes = Buffer.from(sourceBytes)
  mutatedBytes[mutatedBytes.length - 1] ^= 1
  await writeFile(sourcePath, mutatedBytes)
  try {
    await assert.rejects(
      execFileAsync(process.execPath, ['tooling/icon-registry.mjs', '--check'], { cwd: REPOSITORY_ROOT }),
      error => /generated registry is stale/.test(`${error.stdout ?? ''}${error.stderr ?? ''}`)
    )
  } finally {
    await writeFile(sourcePath, sourceBytes)
  }
})

test('rejects registry paths that escape through a symlink before reading them', async () => {
  const allowedRoot = await mkdtemp(join(tmpdir(), 'icon-registry-'))
  const outside = await mkdtemp(join(tmpdir(), 'icon-registry-outside-'))
  const target = join(outside, 'secret.svg')
  const link = join(allowedRoot, 'escape.svg')
  try {
    await writeFile(target, '<svg viewBox="0 0 1 1"/>')
    await symlink(target, link)
    await assert.rejects(resolveContainedPath(link, allowedRoot, 'fixture source'), /resolves outside/)
    await assert.rejects(resolveContainedPath(link, allowedRoot, 'fixture provenance sourcePath'), /resolves outside/)
  } finally {
    await Promise.all([rm(allowedRoot, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
  }
})

test('rejects reusable SVG references to keep generated IDs scoped', () => {
  assert.throws(() => validateSvg('<svg viewBox="0 0 24 24"><defs><path id="shape" d="M0 0"/></defs><use href="#shape"/></svg>', metadata), /unsupported SVG element use/)
})

test('preserves validated root presentation attributes around generated geometry', () => {
  const result = validateSvg(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 1h22"/></svg>',
    metadata
  )
  assert.match(result.geometry, /^<g fill="none" stroke="currentColor" stroke-width="1\.5" stroke-linecap="round"><path/)

  const transformed = validateSvg('<svg viewBox="0 0 24 24" transform="translate(1 2)" opacity="0.5"><path d="M1 1h22"/></svg>', metadata)
  assert.match(transformed.geometry, /^<g transform="translate\(1 2\)" opacity="0\.5"><path/)
})

test('escapes decoded root attribute values before generating geometry', () => {
  const result = validateSvg('<svg viewBox="0 0 24 24" stroke="#fff&#34;onload&#61;&#34;alert(1)"><path d="M1 1h22"/></svg>', {
    ...metadata,
    paint: 'fixed'
  })
  assert.match(result.geometry, /stroke="#fff&quot;onload=&quot;alert\(1\)"/)
})

test('renders static Vite asset imports for non-inline kinds', () => {
  const generated = renderGeneratedRegistry({
    mask: {
      kind: 'mask',
      source: 'mask.svg',
      viewBox: '0 0 24 24',
      defaultSize: 24,
      paint: 'mask-currentColor',
      accessibility: 'decorative',
      sourceHash: 'test',
      provenance: { sourcePath: 'test', sourceCommit: 'test' }
    }
  })
  assert.match(generated, /import iconAsset0 from "\.\.\/assets\/icons\/mask\.svg\?url"/)
  assert.match(generated, /"source": iconAsset0/)
})

test('enforces kind-specific registry metadata', () => {
  const provenance = { sourcePath: 'source.svg', sourceCommit: 'abc123' }
  for (const defaultSize of [15, 17]) {
    assert.doesNotThrow(() =>
      validateManifestEntry(`compact-${defaultSize}`, {
        kind: 'inline',
        source: 'icon.svg',
        viewBox: '0 0 24 24',
        defaultSize,
        paint: 'currentColor',
        accessibility: 'decorative',
        provenance
      })
    )
  }
  assert.throws(
    () => validateManifestEntry('missing-mask-paint', { kind: 'mask', source: 'mask.svg', viewBox: '0 0 24 24', defaultSize: 24, paint: 'currentColor', accessibility: 'decorative', provenance }),
    /mask paint/
  )
  assert.throws(
    () => validateManifestEntry('missing-raster-size', { kind: 'raster', source: 'image.png', defaultSize: 24, paint: 'fixed', accessibility: 'decorative', provenance }),
    /intrinsic dimensions/
  )
  assert.doesNotThrow(() =>
    validateManifestEntry('brand', {
      kind: 'brand',
      source: 'brand.svg',
      intrinsicWidth: 32,
      intrinsicHeight: 32,
      defaultSize: 32,
      paint: 'fixed',
      accessibility: 'standalone',
      label: 'Brand',
      provenance
    })
  )
  assert.throws(
    () => validateManifestEntry('blank-standalone-label', { kind: 'inline', source: 'icon.svg', viewBox: '0 0 24 24', defaultSize: 24, paint: 'currentColor', accessibility: 'standalone', label: ' \t ', provenance }),
    /standalone label must not be blank/
  )
  assert.throws(
    () => validateManifestEntry('decorative-label', { kind: 'inline', source: 'icon.svg', viewBox: '0 0 24 24', defaultSize: 24, paint: 'currentColor', accessibility: 'decorative', label: 'Ignored', provenance }),
    /labels are only valid/
  )
})

for (const [name, source, expected] of [
  ['DOCTYPE', '<!DOCTYPE svg><svg viewBox="0 0 24 24"/>', /DOCTYPE/],
  ['script', '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>', /active SVG/],
  ['style element', '<svg viewBox="0 0 24 24"><style>.x{fill:red}</style></svg>', /active SVG/],
  ['event handler', '<svg viewBox="0 0 24 24" onload="alert(1)"/>', /event handler/],
  ['foreignObject', '<svg viewBox="0 0 24 24"><foreignObject><div/></foreignObject></svg>', /active SVG/],
  ['CSS url', '<svg viewBox="0 0 24 24"><path fill="url(#paint)"/></svg>', /CSS url/],
  ['external href', '<svg viewBox="0 0 24 24"><path href="https://example.com/icon.svg" d="M0 0"/></svg>', /non-fragment/],
  ['missing viewBox', '<svg><path d="M0 0"/></svg>', /require a viewBox/],
  ['fixed paint under currentColor', '<svg viewBox="0 0 24 24"><path fill="#111"/></svg>', /incompatible/]
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => validateSvg(source, metadata), expected)
  })
}
