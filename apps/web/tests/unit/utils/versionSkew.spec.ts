import { isVersionSkewError } from '~~/app/utils/versionSkew'

import { describe, expect, it } from 'vitest'

describe('isVersionSkewError', () => {
  it.each([
    'WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f @+0',
    "Unexpected token '<'",
    "SyntaxError: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
    "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of 'text/html'.",
    'Failed to fetch dynamically imported module: https://r.slax.com/_nuxt/abc.js',
    'Importing a module script failed.',
    'error loading dynamically imported module: https://r.slax.com/_nuxt/abc.js'
  ])('detects %s', message => {
    expect(isVersionSkewError(new Error(message))).toBe(true)
  })

  it('looks through wrapped causes and plain strings', () => {
    const wasm = new Error('WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f')
    expect(isVersionSkewError(new Error('init failed', { cause: wasm }))).toBe(true)
    expect(isVersionSkewError("Unexpected token '<'")).toBe(true)
  })

  it.each([
    new DOMException('The operation is insecure.', 'SecurityError'),
    new DOMException('Encountered full disk while opening backing store', 'QuotaExceededError'),
    new Error('Timeout while acquiring lock'),
    new Error('Failed to fetch'),
    new Error('database disk image is malformed'),
    null,
    undefined,
    42,
    {}
  ])('ignores %s', error => {
    expect(isVersionSkewError(error)).toBe(false)
  })

  it('stops on cyclic or very deep causes', () => {
    const cyclic = new Error('outer') as Error & { cause?: unknown }
    const inner = new Error('inner', { cause: cyclic })
    cyclic.cause = inner
    expect(isVersionSkewError(cyclic)).toBe(false)
    let deep: Error = new Error("Unexpected token '<'")
    for (let i = 0; i < 20; i++) deep = new Error(`wrap ${i}`, { cause: deep })
    expect(isVersionSkewError(deep)).toBe(false)
  })

  it('never throws on hostile errors', () => {
    const hostile = { get message() { throw new Error('boom') } }
    expect(isVersionSkewError(hostile)).toBe(false)
  })
})
