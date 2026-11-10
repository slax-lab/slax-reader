import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('loadDeferredUi', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('__SLAX_DEFERRED_INDEX__', 'fixture-index.json')
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['panel.js', 'renderer.js', 'panel.css'])('keeps a failed %s outside the module loader and retries it', async failedFile => {
    let failing = true
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const name = new URL(input).pathname.split('/').at(-1)!
      requests.push(name)
      if (name === 'fixture-index.json') return Response.json({ Panel: ['panel.js', 'renderer.js', 'panel.css'] })
      if (failing && name === failedFile) return new Response('unavailable', { status: 503 })
      return new Response('resource', { headers: { 'content-type': name.endsWith('.css') ? 'text/css' : 'text/javascript' } })
    }))
    const { loadDeferredUi } = await import('~~/app/utils/deferredUi')
    const load = vi.fn().mockResolvedValue({ default: 'Panel' })
    await expect(loadDeferredUi('Panel', load)).rejects.toThrow('resource unavailable')
    expect(load).not.toHaveBeenCalled()
    failing = false
    await expect(loadDeferredUi('Panel', load)).resolves.toEqual({ default: 'Panel' })
    expect(load).toHaveBeenCalledOnce()
    expect(requests.filter(name => name === failedFile)).toHaveLength(2)
    expect(requests.filter(name => name === 'fixture-index.json')).toHaveLength(1)
  })

  it('does not execute HTML fallback as an optional module', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('fixture-index.json')
      ? Response.json({ Panel: ['panel.js'] })
      : new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })))
    const { loadDeferredUi } = await import('~~/app/utils/deferredUi')
    const load = vi.fn()
    await expect(loadDeferredUi('Panel', load)).rejects.toThrow('resource unavailable')
    expect(load).not.toHaveBeenCalled()
  })

  it('retries a failed index and shares successful resource requests', async () => {
    let attempts = 0
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('fixture-index.json')) {
        if (++attempts === 1) return new Response(null, { status: 503 })
        return Response.json({ Panel: ['panel.js'] })
      }
      return new Response('module', { headers: { 'content-type': 'text/javascript' } })
    })
    vi.stubGlobal('fetch', fetcher)
    const { loadDeferredUi } = await import('~~/app/utils/deferredUi')
    const load = vi.fn().mockResolvedValue('ok')
    await expect(loadDeferredUi('Panel', load)).rejects.toThrow('index unavailable')
    await Promise.all([loadDeferredUi('Panel', load), loadDeferredUi('Panel', load)])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('preserves direct loading in development without a generated index', async () => {
    vi.stubGlobal('__SLAX_DEFERRED_INDEX__', undefined)
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const { loadDeferredUi } = await import('~~/app/utils/deferredUi')
    await expect(loadDeferredUi('Panel', async () => 'ok')).resolves.toBe('ok')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
