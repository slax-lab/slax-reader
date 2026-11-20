import type { ClientErrorRecord } from '@commons/frontend-utils/errorLog'
import { boundedProperties, chunkBodies, compactStack, createErrorCollector, errorFingerprint, firstFrame, installGlobalErrorCapture, normalizeError, stripUrl, stripUrlQueries, truncateBytes } from '@commons/frontend-utils/errorLog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const endpoint = 'https://stream.ingest.invalid'
const make = (overrides: Partial<Parameters<typeof createErrorCollector>[0]> = {}) => {
  const sent: { body: ClientErrorRecord[]; hiding: boolean }[] = []
  const collector = createErrorCollector({
    endpoint,
    app: 'web',
    release: '2.1.0',
    env: 'production',
    pageUrl: () => 'https://r.slax.com/b/abc?token=secret#frag',
    send: (_url, body, hiding) => void sent.push({ body: JSON.parse(body), hiding }),
    ...overrides
  })
  return { collector, sent }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('frontend-utils error log collector', () => {
  it('is disabled without an https endpoint, a known env, or a semver release', async () => {
    const send = vi.fn()
    for (const opts of [{ endpoint: '' }, { endpoint: 'http://x.invalid' }, { env: 'staging' }, { release: 'latest' }]) {
      const collector = createErrorCollector({ endpoint, app: 'web', release: '2.1.0', env: 'production', send, ...opts })
      expect(collector.enabled).toBe(false)
      collector.capture('error', new Error('x'))
      await collector.flush()
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('groups repeats into one record with a count and merges capture sources', async () => {
    const { collector, sent } = make()
    const error = new Error('HTTP 503 from sync')
    for (let i = 0; i < 50; i++) collector.capture('powersync', error, { source: i % 2 ? 'sdk.logger' : 'status.downloadError' })
    await collector.flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toHaveLength(1)
    const [record] = sent[0].body
    expect(record).toMatchObject({ kind: 'powersync', count: 50, error_name: 'Error', message: 'HTTP 503 from sync', app: 'web', env: 'production', release: '2.1.0' })
    expect(record.properties?.sources).toEqual(['status.downloadError', 'sdk.logger'])
    expect(record.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(record.session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('lets a non-counting observer tag a failure without inflating its count', async () => {
    const { collector, sent } = make()
    const upload = () => new Error('[powersync] upload changes failed: 500')
    // Each retry: the connector counts it, the status listener only tags it.
    for (let i = 0; i < 3; i++) {
      collector.capture('powersync', upload(), { source: 'connector.upload' })
      collector.capture('powersync', upload(), { source: 'status.uploadError' }, { countOccurrence: false })
    }
    // The status listener alone, then its counting source arriving later.
    collector.capture('powersync', new Error('sync stream 503'), { source: 'status.downloadError' }, { countOccurrence: false })
    collector.capture('powersync', new Error('sync stream 503'), { source: 'sdk.logger' })
    collector.capture('powersync', new Error('only seen by status'), { source: 'status.uploadError' }, { countOccurrence: false })
    await collector.flush()
    const byMessage = Object.fromEntries(sent[0].body.map(record => [record.message, record]))
    expect(byMessage['[powersync] upload changes failed: 500']).toMatchObject({ count: 3, properties: { sources: ['connector.upload', 'status.uploadError'] } })
    expect(byMessage['sync stream 503']).toMatchObject({ count: 1, properties: { sources: ['status.downloadError', 'sdk.logger'] } })
    expect(byMessage['only seen by status'].count).toBe(1)
  })

  it('strips the query and fragment from page and script URLs', async () => {
    const { collector, sent } = make()
    collector.capture('error', new TypeError('boom'))
    await collector.flush()
    expect(sent[0].body[0].page_url).toBe('https://r.slax.com/b/abc')
    expect(stripUrl('chrome-extension://abcdefghijklmnop/offscreen.html?x=1')).toBe('chrome-extension://abcdefghijklmnop/offscreen.html')
    expect(stripUrl('javascript:alert(1)')).toBeUndefined()
  })

  it('removes query strings and fragments from URLs inside messages and stacks', async () => {
    const { collector, sent } = make()
    const error = new Error('Failed to fetch https://r.slax.com/b/1?token=secret#x for reading')
    error.stack = 'Error: boom\n    at f (https://r.slax.com/_nuxt/a.js?v=2:1:5)\n    at g (chrome-extension://abcdef/offscreen.html?session=abc:3:4)'
    collector.capture('error', error)
    await collector.flush()
    const [record] = sent[0].body
    expect(record.message).toBe('Failed to fetch https://r.slax.com/b/1 for reading')
    expect(record.stack).toBe('f (a.js:1:5)')
    expect(normalizeError(error).stack).toContain('chrome-extension://abcdef/offscreen.html:3:4')
    expect(stripUrlQueries('GET /v1/sync/changes?token=abc failed')).toBe('GET /v1/sync/changes failed')
    expect(stripUrlQueries('ratio 3/4? no urls here')).toBe('ratio 3/4? no urls here')
  })

  it('removes queries from Safari and Firefox frames, bracketed URLs, and protocol-relative URLs', () => {
    const cases: Array<[string, string]> = [
      ['fetchStreamRaw@https://r.slax.com/_nuxt/a.js?v=1:12:3', 'fetchStreamRaw@https://r.slax.com/_nuxt/a.js:12:3'],
      ['@https://r.slax.com/_nuxt/a.js?v=1#x:12:3', '@https://r.slax.com/_nuxt/a.js:12:3'],
      ['Failed [https://r.slax.com/a?token=1]', 'Failed [https://r.slax.com/a]'],
      ['{"url":"https://r.slax.com/a?token=1"}', '{"url":"https://r.slax.com/a"}'],
      ['x:https://r.slax.com/a?token=1', 'x:https://r.slax.com/a'],
      ['load-https://r.slax.com/a?token=1', 'load-https://r.slax.com/a'],
      ['see //r.slax.com/a?token=1 now', 'see //r.slax.com/a now'],
      ['fn@/_nuxt/a.js?v=1:2:3', 'fn@/_nuxt/a.js:2:3'],
      ['[/v1/sync/changes?token=abc]', '[/v1/sync/changes]'],
      ['and/or? maybe', 'and/or? maybe']
    ]
    for (const [input, expected] of cases) expect(stripUrlQueries(input)).toBe(expected)
    const safari = Object.assign(new Error('boom'), { stack: 'fetchStreamRaw@https://r.slax.com/_nuxt/w.js?v=1:12:3\nother@https://r.slax.com/_nuxt/x.js?v=1:1:1' })
    expect(firstFrame(normalizeError(safari).stack)).toBe('fetchStreamRaw@https://r.slax.com/_nuxt/w.js:12:3')
  })

  it('keeps only the route shape of share and collection pages in page_url', async () => {
    const urls: Array<[string, string]> = [
      ['https://r.slax.com/s/2kZx9abc1234?ref=x', 'https://r.slax.com/s/:code'],
      ['https://r.slax.com/c/K8q2z/', 'https://r.slax.com/c/:code/'],
      ['https://r.slax.com/c/K8q2z', 'https://r.slax.com/c/:code'],
      ['https://r.slax.com/c/K8q2z/42', 'https://r.slax.com/c/:code/:id'],
      ['https://r.slax.com/b/123', 'https://r.slax.com/b/123'],
      ['https://r.slax.com/bookmarks', 'https://r.slax.com/bookmarks'],
      ['https://r.slax.com/collection/manage', 'https://r.slax.com/collection/manage']
    ]
    for (const [pageUrl, expected] of urls) {
      const { collector, sent } = make({ pageUrl: () => pageUrl })
      collector.capture('error', new Error(`x ${pageUrl}`))
      await collector.flush()
      expect(sent[0].body[0].page_url).toBe(expected)
    }
  })

  it('bounds the message in bytes and keeps a compact stack', async () => {
    const { collector, sent } = make()
    const error = new Error('é'.repeat(20000))
    error.stack = `Error: ${'é'.repeat(20)}\n    at deep${'x'.repeat(2000)} (https://r.slax.com/a.js:1:2)\n    at second (https://r.slax.com/b.js:3:4)`
    collector.capture('error', error)
    await collector.flush()
    const [record] = sent[0].body
    expect(new TextEncoder().encode(record.message).length).toBeLessThanOrEqual(16 * 1024)
    const frames = record.stack?.split('\n') ?? []
    expect(frames[0].startsWith('deepx')).toBe(true)
    expect(new TextEncoder().encode(frames[0]).length).toBeLessThanOrEqual(512)
    expect(frames[1]).toBe('second (b.js:3:4)')
    expect(new TextEncoder().encode(record.stack ?? '').length).toBeLessThanOrEqual(1024)
    expect(truncateBytes('abc', 2)).toBe('ab')
  })

  it('compacts V8 and Safari stacks to five short application frames', () => {
    const v8 = [
      'TypeError: Failed to fetch',
      '    at window.fetch (https://r.slax.com/_nuxt/HkvhJBOe.js:12:5)',
      '    at Object.uploadChanges (https://r.slax.com/_nuxt/HkvhJBOe.js:17541:24)',
      '    at callWithErrorHandling (https://r.slax.com/_nuxt/vue.js:1:1)',
      '    at chrome-extension://abcdef/content.js:2:2',
      '    at Array.forEach (<anonymous>)',
      '    at async uploadData (https://r.slax.com/_nuxt/HkvhJBOe.js:12000:9)',
      '    at f (https://r.slax.com/_nuxt/a.js:1:1)',
      '    at f (https://r.slax.com/_nuxt/a.js:1:1)',
      '    at async https://r.slax.com/_nuxt/worker-v4.js:3239:35',
      '    at g (https://r.slax.com/_nuxt/b.js:2:2)',
      '    at h (https://r.slax.com/_nuxt/c.js:3:3)'
    ].join('\n')
    expect(compactStack(v8)).toBe(['window.fetch (HkvhJBOe.js:12:5)', 'Object.uploadChanges (HkvhJBOe.js:17541:24)', 'async uploadData (HkvhJBOe.js:12000:9)', 'f (a.js:1:1)', 'worker-v4.js:3239:35'].join('\n'))
    const safari = normalizeError(Object.assign(new Error('x'), { stack: 'fetchStreamRaw@https://r.slax.com/_nuxt/worker-v4.js?v=1:3239:44\n[native code]\n@https://r.slax.com/_nuxt/a.js:1:2' })).stack
    expect(compactStack(safari)).toBe('fetchStreamRaw (worker-v4.js:3239:44)\na.js:1:2')
    expect(compactStack('Error: x\n    at Array.forEach (<anonymous>)')).toBe('Array.forEach (<anonymous>)')
    expect(compactStack('SyntaxError: x\n    at JSON.parse (<anonymous>)\n    at <anonymous> (https://r.slax.com/_nuxt/a.js:3:32)\n    at Array.forEach (<anonymous>)\n    at load (https://r.slax.com/_nuxt/a.js:3:11)')).toBe('a.js:3:32\nload (a.js:3:11)')
    expect(compactStack('SyntaxError: x\nparse@[native code]\n@https://r.slax.com/_nuxt/a.js:3:32\nforEach@[native code]')).toBe('a.js:3:32')
    expect(compactStack('Error: only a message')).toBeUndefined()
    expect(compactStack(undefined)).toBeUndefined()
  })

  it('picks the first real frame in V8 and Firefox stacks, never a message line', () => {
    expect(firstFrame('TypeError: failed for user@example.com\n    at upload (https://r.slax.com/_nuxt/x.js:10:2)\n    at run (y.js:1:1)')).toBe('at upload (https://r.slax.com/_nuxt/x.js:10:2)')
    expect(firstFrame('upload@https://r.slax.com/_nuxt/x.js:10:2\nrun@y.js:1:1')).toBe('upload@https://r.slax.com/_nuxt/x.js:10:2')
    expect(firstFrame('Error: only a message')).toBeUndefined()
    expect(firstFrame('Error: user@example.com is not valid\n    at check (https://r.slax.com/_nuxt/x.js:4:1)')).toBe('at check (https://r.slax.com/_nuxt/x.js:4:1)')
    expect(firstFrame('user@example.com is not valid\ncheck@https://r.slax.com/_nuxt/x.js:4:1')).toBe('check@https://r.slax.com/_nuxt/x.js:4:1')
    expect(firstFrame(undefined)).toBeUndefined()
  })

  it('caps distinct fingerprints per session at 200', async () => {
    const { collector, sent } = make()
    for (let i = 0; i < 260; i++) collector.capture('error', { name: 'Error', message: `distinct ${'x'.repeat(i)}` })
    await collector.flush()
    await vi.runAllTimersAsync()
    expect(sent.flatMap(batch => batch.body)).toHaveLength(200)
  })

  it('flushes after the delay and immediately at 20 queued fingerprints', async () => {
    const { collector, sent } = make({ flushDelayMs: 5000 })
    collector.capture('error', new Error('one'))
    expect(sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent).toHaveLength(1)
    for (let i = 0; i < 20; i++) collector.capture('error', { name: 'Error', message: `burst ${'y'.repeat(i)}` })
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toHaveLength(2)
    expect(sent[1].body).toHaveLength(20)
  })

  it('adds numeric user ids and device ids, and drops non-numeric user ids', async () => {
    const numeric = make({ getContext: () => ({ userId: 10001, deviceId: 'dev-1' }) })
    numeric.collector.capture('error', new Error('a'))
    await numeric.collector.flush()
    expect(numeric.sent[0].body[0]).toMatchObject({ user_id: '10001', device_id: 'dev-1' })
    const email = make({ getContext: () => ({ userId: 'someone@example.com' }) })
    email.collector.capture('error', new Error('a'))
    await email.collector.flush()
    expect(email.sent[0].body[0].user_id).toBeUndefined()
  })

  it('attributes a hiding flush with the identity resolved by an earlier flush', async () => {
    const getContext = vi.fn().mockResolvedValue({ userId: 7, deviceId: 'dev-7' })
    const { collector, sent } = make({ getContext })
    collector.capture('error', new Error('first'))
    await collector.flush()
    collector.capture('error', new Error('on unload'))
    await collector.flush(true)
    expect(getContext).toHaveBeenCalledOnce()
    expect(sent[1]).toMatchObject({ hiding: true, body: [{ message: 'on unload', user_id: '7', device_id: 'dev-7' }] })
  })

  it('swallows delivery failures without capturing them', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network down'))
    const { collector } = make({ send })
    collector.capture('error', new Error('original'))
    await expect(collector.flush()).resolves.toBeUndefined()
    await collector.flush()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('normalizes thrown non-errors, ErrorEvents, and cloned errors', () => {
    expect(normalizeError('plain string')).toEqual({ message: 'plain string' })
    expect(normalizeError({ type: 'error', message: 'Uncaught Error: crash', error: null })).toMatchObject({ message: 'Uncaught Error: crash' })
    expect(normalizeError({ type: 'error', error: new RangeError('inner') })).toMatchObject({ name: 'RangeError', message: 'inner' })
    expect(normalizeError({ name: '<script>', message: 'x' }).name).toBeUndefined()
    expect(normalizeError({ code: 7 }).message).toBe('{"code":7}')
  })

  it('fingerprints ignore long numbers and line positions but keep status codes', () => {
    const a = errorFingerprint('error', 'Error', 'request 1795086933686 failed', 'Error\n    at f (https://r.slax.com/a.js:1:20)')
    const b = errorFingerprint('error', 'Error', 'request 1795099999999 failed', 'Error\n    at f (https://r.slax.com/a.js:9:99)')
    expect(a).toBe(b)
    expect(errorFingerprint('vue', 'Error', 'request 1795086933686 failed', undefined)).not.toBe(a)
    const unauthorized = errorFingerprint('powersync', 'Error', '[powersync] upload changes failed: 401', undefined)
    const serverError = errorFingerprint('powersync', 'Error', '[powersync] upload changes failed: 500', undefined)
    expect(unauthorized).not.toBe(serverError)
  })

  it('keeps oversized properties within 8 KiB, with their keys and sources, after JSON escaping', () => {
    const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
    for (const value of ['"'.repeat(20000), '\\'.repeat(20000), '\u0001'.repeat(20000), '中'.repeat(20000), 'a'.repeat(20000)]) {
      const bounded = boundedProperties({ src: 'https://r.slax.com/_nuxt/a.js', detail: value, nested: { list: [value] }, sources: ['sdk.logger'] })
      expect(bounded).toMatchObject({ truncated: true, src: 'https://r.slax.com/_nuxt/a.js', sources: ['sdk.logger'] })
      expect(typeof bounded?.detail).toBe('string')
      expect(bounded).toHaveProperty('nested')
      expect(size(bounded)).toBeLessThanOrEqual(8 * 1024 - 1024)
    }
    expect(boundedProperties({ src: 'https://r.slax.com/_nuxt/a.js' })).toEqual({ src: 'https://r.slax.com/_nuxt/a.js' })
  })

  it('leaves room for sources merged into a queued record with oversized properties', async () => {
    const { collector, sent } = make()
    const error = new Error('oversized')
    collector.capture('powersync', error, { source: 'sdk.logger', detail: 'x'.repeat(20000) })
    for (const source of ['status.downloadError', 'status.uploadError', 'connector.upload', 'app.connect']) collector.capture('powersync', error, { source })
    await collector.flush()
    const [record] = sent[0].body
    expect(record.properties?.sources).toEqual(['sdk.logger', 'status.downloadError', 'status.uploadError', 'connector.upload', 'app.connect'])
    expect(new TextEncoder().encode(JSON.stringify(record.properties)).length).toBeLessThanOrEqual(8 * 1024)
  })

  it('splits a batch into request bodies below the keepalive and beacon limit', () => {
    const records = Array.from({ length: 20 }, (_, i) => ({ message: `m${i}:${'x'.repeat(16 * 1024)}` }) as unknown as ClientErrorRecord)
    const bodies = chunkBodies(records)
    expect(bodies.length).toBeGreaterThan(1)
    for (const body of bodies) expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(60 * 1024)
    expect(bodies.flatMap(body => JSON.parse(body) as unknown[])).toHaveLength(20)
    expect(chunkBodies([])).toEqual([])
  })
})

describe('installGlobalErrorCapture', () => {
  const listenerTarget = () => {
    type Listener = (event: Record<string, unknown>) => void
    const listeners: Record<string, Listener> = {}
    return { listeners, target: { addEventListener: (type: string, listener: Listener) => void (listeners[type] = listener) } }
  }

  it('captures uncaught errors, rejections, and failed scripts but ignores other resources', async () => {
    const { collector, sent } = make()
    const { listeners, target } = listenerTarget()
    installGlobalErrorCapture(collector, target)
    listeners.error({ target, error: new TypeError('x is undefined'), message: 'Uncaught TypeError', filename: 'https://r.slax.com/_nuxt/a.js?v=1', lineno: 3, colno: 4 })
    listeners.unhandledrejection({ reason: new Error('rejected') })
    listeners.error({ target: { tagName: 'SCRIPT', src: 'https://r.slax.com/_nuxt/chunk.js?v=2' } })
    listeners.error({ target: { tagName: 'IMG', src: 'https://r.slax.com/a.png' } })
    listeners.error({ target: { tagName: 'LINK', href: 'https://r.slax.com/a.css' } })
    await collector.flush()
    const records = sent[0].body
    expect(records.map(r => r.kind)).toEqual(['error', 'unhandledrejection', 'resource'])
    expect(records[0].properties).toMatchObject({ filename: 'https://r.slax.com/_nuxt/a.js', lineno: 3, colno: 4 })
    expect(records[2]).toMatchObject({ message: 'Script failed to load: https://r.slax.com/_nuxt/chunk.js', properties: { src: 'https://r.slax.com/_nuxt/chunk.js' } })
  })

  it('flushes as a beacon when the document is hidden', async () => {
    const { collector, sent } = make()
    const docListeners: Record<string, () => void> = {}
    const document = { visibilityState: 'visible', addEventListener: (type: string, listener: () => void) => void (docListeners[type] = listener) }
    const { listeners, target } = listenerTarget()
    installGlobalErrorCapture(collector, { ...target, document } as never)
    collector.capture('error', new Error('before close'))
    document.visibilityState = 'hidden'
    docListeners.visibilitychange()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toHaveLength(1)
    expect(sent[0].hiding).toBe(true)
    expect(listeners.pagehide).toBeTypeOf('function')
  })

  it('installs nothing for a disabled collector', () => {
    const { listeners, target } = listenerTarget()
    installGlobalErrorCapture(createErrorCollector({ endpoint: '', app: 'web', release: '2.1.0', env: 'production' }), target)
    expect(Object.keys(listeners)).toHaveLength(0)
  })
})
