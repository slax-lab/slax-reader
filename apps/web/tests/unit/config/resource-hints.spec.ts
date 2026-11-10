import { removeDatabasePrefetch } from '../../../config/resource-hints'

import { describe, expect, it } from 'vitest'

const modules = [
  '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs',
  '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs',
  '@journeyapps/wa-sqlite/dist/mc-wa-sqlite.mjs',
  '@journeyapps/wa-sqlite/dist/mc-wa-sqlite-async.mjs',
  '@powersync/shared-internals/dist/websockets.mjs'
]

describe('removeDatabasePrefetch', () => {
  it.each(modules)('changes only prefetch for %s', source => {
    const key = `../../../node_modules/.pnpm/package/node_modules/${source}`
    const manifest = { [key]: { src: key, prefetch: true, preload: true, file: 'hash.js', isDynamicEntry: true, imports: ['shared.js'], assets: ['runtime.wasm'], css: ['runtime.css'] } }
    const original = structuredClone(manifest)
    removeDatabasePrefetch(manifest)
    expect(manifest).toEqual({ [key]: { ...original[key], prefetch: false } })
  })

  it.each(modules)('supports bare identities and Windows paths for %s', source => {
    const windows = `C:/repo/node_modules/${source}`.replaceAll('/', String.fromCharCode(92)) + '?worker'
    const manifest = { [source]: { prefetch: true }, opaque: { src: windows, prefetch: true, preload: true } }
    removeDatabasePrefetch(manifest)
    expect(manifest[source].prefetch).toBe(false)
    expect(manifest.opaque).toEqual({ src: windows, prefetch: false, preload: true })
  })

  it('uses declared source rather than a misleading manifest key', () => {
    const manifest = { [modules[0]!]: { src: 'app/ordinary.ts', prefetch: true } }
    const original = structuredClone(manifest)
    removeDatabasePrefetch(manifest)
    expect(manifest).toEqual(original)
  })

  it('leaves unknown resources and other backend assets unchanged', () => {
    const sources = ['hash.js', 'app/sqlite.ts', '@journeyapps/wa-sqlite/dist/wa-sqlite.wasm', '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js', '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs.map', '@powersync/shared-internals/dist/websockets.mjs/other', '@other/wa-sqlite/dist/wa-sqlite.mjs', 'app/@journeyapps/wa-sqlite/dist/wa-sqlite.mjs', 'app/vue.js']
    const manifest = Object.fromEntries(sources.map(src => [src, { src, prefetch: true, preload: true }]))
    const original = structuredClone(manifest)
    removeDatabasePrefetch(manifest)
    expect(manifest).toEqual(original)
  })

  it('is idempotent and accepts an empty manifest', () => {
    const manifest = { [modules[0]!]: { prefetch: false } }
    removeDatabasePrefetch(manifest)
    removeDatabasePrefetch(manifest)
    expect(manifest).toEqual({ [modules[0]!]: { prefetch: false } })
    expect(() => removeDatabasePrefetch({})).not.toThrow()
  })
})
