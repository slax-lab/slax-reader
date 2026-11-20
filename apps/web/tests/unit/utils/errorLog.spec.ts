import type { ClientErrorRecord } from '@commons/frontend-utils/errorLog'
import { boundedProperties, chunkBodies, compactStack, createErrorCollector, errorFingerprint, firstFrame, installGlobalErrorCapture, normalizeError, redactCapabilityPaths, stripUrl, stripUrlQueries, truncateBytes,urlForRecord } from '@commons/frontend-utils/errorLog'
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
    expect(record.stack).toBe('f (a.js:1:5)\ng (chrome-extension://abcdef/offscreen.html:3:4)')
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
    for (const [input, expected] of cases) expect(stripUrlQueries(input, { keepPosition: true })).toBe(expected)
    // In a message, `:digits` after a query belongs to the query and goes with it.
    expect(stripUrlQueries('see https://r.slax.com/a?b=:1:2 now')).toBe('see https://r.slax.com/a now')
    expect(stripUrlQueries('see https://r.slax.com/a#:42 now')).toBe('see https://r.slax.com/a now')
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

  it('bounds the message in bytes and keeps a compact stack within 4 KiB', async () => {
    const { collector, sent } = make()
    const error = new Error('é'.repeat(20000))
    error.stack = `Error: ${'é'.repeat(20)}\n    at deep${'x'.repeat(2000)} (https://r.slax.com/_nuxt/a.js:1:2)\n    at second (https://r.slax.com/_nuxt/b.js:3:4)`
    collector.capture('error', error)
    await collector.flush()
    const [record] = sent[0].body
    expect(new TextEncoder().encode(record.message).length).toBeLessThanOrEqual(16 * 1024)
    const frames = record.stack?.split('\n') ?? []
    expect(frames[0].startsWith('deepx')).toBe(true)
    expect(new TextEncoder().encode(frames[0]).length).toBeLessThanOrEqual(512)
    expect(frames[1]).toBe('second (b.js:3:4)')
    expect(truncateBytes('abc', 2)).toBe('ab')
  })

  it('keeps every frame of V8 and Safari stacks, shortened, with recursion collapsed', () => {
    const v8 = [
      'TypeError: Failed to fetch',
      '    at window.fetch (https://r.slax.com/_nuxt/HkvhJBOe.js:12:5)',
      '    at Object.uploadChanges (https://r.slax.com/_nuxt/HkvhJBOe.js:17541:24)',
      '    at JSON.parse (<anonymous>)',
      '    at chrome-extension://abcdef/content.js:2:2',
      '    at f (https://r.slax.com/_nuxt/a.js:1:1)',
      '    at f (https://r.slax.com/_nuxt/a.js:1:1)',
      '    at f (https://r.slax.com/_nuxt/a.js:1:1)',
      '    at async https://r.slax.com/_nuxt/worker-v4.js:3239:35',
      '    at https://cdn.example.com/lib.js:1:1'
    ].join('\n')
    expect(compactStack(v8)).toBe(
      [
        'window.fetch (HkvhJBOe.js:12:5)',
        'Object.uploadChanges (HkvhJBOe.js:17541:24)',
        'JSON.parse (<anonymous>)',
        'chrome-extension://abcdef/content.js:2:2',
        'f (a.js:1:1) ×3',
        'async (worker-v4.js:3239:35)',
        'https://cdn.example.com/lib.js:1:1'
      ].join('\n')
    )
    const safari = normalizeError(Object.assign(new Error('x'), { stack: 'fetchStreamRaw@https://r.slax.com/_nuxt/worker-v4.js?v=1:3239:44\nparse@[native code]\n@https://r.slax.com/_nuxt/a.js:1:2' })).stack
    expect(compactStack(safari)).toBe('fetchStreamRaw (worker-v4.js:3239:44)\nparse ([native code])\na.js:1:2')
    expect(compactStack('Error: only a message')).toBeUndefined()
    expect(compactStack(undefined)).toBeUndefined()
  })

  it('cuts a deep stack at 4 KiB and says how many frames were dropped', () => {
    const deep = 'Error: x\n' + Array.from({ length: 400 }, (_, i) => `    at fn${i} (https://r.slax.com/_nuxt/a${i}.js:${i}:1)`).join('\n')
    const compact = compactStack(deep) ?? ''
    expect(new TextEncoder().encode(compact).length).toBeLessThanOrEqual(4 * 1024)
    const lines = compact.split('\n')
    expect(lines[0]).toBe('fn0 (a0.js:0:1)')
    expect(lines.at(-1)).toBe(`… ${400 - (lines.length - 1)} more frames`)
  })

  it('picks the first real frame in V8 and Firefox stacks, never a message line', () => {
    expect(firstFrame('TypeError: failed for user@example.com\n    at upload (https://r.slax.com/_nuxt/x.js:10:2)\n    at run (y.js:1:1)')).toBe('at upload (https://r.slax.com/_nuxt/x.js:10:2)')
    expect(firstFrame('upload@https://r.slax.com/_nuxt/x.js:10:2\nrun@y.js:1:1')).toBe('upload@https://r.slax.com/_nuxt/x.js:10:2')
    expect(firstFrame('Error: only a message')).toBeUndefined()
    expect(firstFrame('Error: user@example.com is not valid\n    at check (https://r.slax.com/_nuxt/x.js:4:1)')).toBe('at check (https://r.slax.com/_nuxt/x.js:4:1)')
    expect(firstFrame('user@example.com is not valid\ncheck@https://r.slax.com/_nuxt/x.js:4:1')).toBe('check@https://r.slax.com/_nuxt/x.js:4:1')
    expect(firstFrame(undefined)).toBeUndefined()
  })

  it('counts repeats across flushes and backs off instead of sending one record per occurrence', async () => {
    const { collector, sent } = make()
    const start = Date.now()
    // A rejection every 40 seconds for 10 hours, as from a page left open while sync keeps failing.
    for (let i = 0; i < 900; i++) {
      collector.capture('unhandledrejection', new TypeError('Load failed'), { source: 'global' })
      await vi.advanceTimersByTimeAsync(40_000)
    }
    await collector.flush(true)
    const records = sent.flatMap(batch => batch.body)
    expect(records.length).toBeLessThanOrEqual(20)
    expect(records.reduce((sum, record) => sum + record.count, 0)).toBe(900)
    expect(records.at(-1)?.properties?.session_count).toBe(900)
    expect(records[0]).toMatchObject({ count: 1, properties: { session_count: 1 } })
    // The wait between deliveries doubles from one minute and never exceeds an hour.
    const gaps = records.slice(1).map((record, i) => record.occurred_at - records[i].occurred_at)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(61 * 60_000)
    expect(records.every(record => record.occurred_at >= start)).toBe(true)
  })

  it('delivers a burst as one counted record and a new error at once', async () => {
    const { collector, sent } = make()
    const burst = new Error('burst')
    for (let i = 0; i < 50; i++) collector.capture('error', burst)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent.flatMap(batch => batch.body).map(record => record.count)).toEqual([50])
    collector.capture('error', burst)
    collector.capture('error', new Error('other'))
    await vi.advanceTimersByTimeAsync(5000)
    // The repeat waits for its interval; the new error does not.
    expect(sent.at(-1)?.body.map(record => record.message)).toEqual(['other'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent.at(-1)?.body).toMatchObject([{ message: 'burst', count: 1, properties: { session_count: 51 } }])
  })

  it('sends held repeats when the page is hidden', async () => {
    const { collector, sent } = make()
    const again = new Error('again')
    collector.capture('error', again)
    await collector.flush()
    collector.capture('error', again)
    collector.capture('error', again)
    await collector.flush()
    expect(sent).toHaveLength(1)
    await collector.flush(true)
    expect(sent[1]).toMatchObject({ hiding: true, body: [{ message: 'again', count: 2, properties: { session_count: 3 } }] })
  })

  it('bounds page_url so one record always fits a request body', async () => {
    const { collector, sent } = make({ pageUrl: () => `https://r.slax.com/b/${'x'.repeat(70_000)}` })
    collector.capture('error', new Error('long path'))
    await collector.flush()
    const [record] = sent[0].body
    expect(record.page_url?.startsWith('https://r.slax.com/b/xxx')).toBe(true)
    expect(new TextEncoder().encode(record.page_url ?? '').length).toBeLessThanOrEqual(2 * 1024)
  })

  it('removes share and collection codes from every URL field, not only page_url', async () => {
    const { collector, sent } = make({ pageUrl: () => 'https://r.slax.com/s/2kZx9abc1234' })
    const error = new TypeError('Failed to load https://r.slax.com/s/2kZx9abc1234 and /c/K8q2z/42')
    error.stack = 'TypeError: x\n    at https://r.slax.com/s/2kZx9abc1234:39:51\n    at f (https://r.slax.com/c/K8q2z/42:3:4)'
    collector.capture('error', error, { source: 'global', filename: 'https://r.slax.com/s/2kZx9abc1234' })
    await collector.flush()
    const serialized = JSON.stringify(sent[0].body)
    expect(serialized).not.toContain('2kZx9abc1234')
    expect(serialized).not.toContain('K8q2z')
    const [record] = sent[0].body
    expect(record.message).toBe('Failed to load https://r.slax.com/s/:code and /c/:code/:id')
    expect(record.stack).toContain('https://r.slax.com/s/:code:39:51')
    expect(record.page_url).toBe('https://r.slax.com/s/:code')
    expect(redactCapabilityPaths('files in /usr/s/x and https://r.slax.com/bookmarks/s/x stay')).toBe('files in /usr/s/x and https://r.slax.com/bookmarks/s/x stay')
    expect(urlForRecord('https://r.slax.com/c/K8q2z?x=1')).toBe('https://r.slax.com/c/:code')
  })

  it('compacts the stack only for a new record, not for each repeat', async () => {
    const { collector, sent } = make()
    const failure = new Error('repeat')
    failure.stack = 'Error: repeat\n' + Array.from({ length: 50 }, (_, i) => `    at fn${i} (https://r.slax.com/_nuxt/a.js:${i}:1)`).join('\n')
    // Compacting splits the stack into lines; count those splits on this stack.
    const split = vi.spyOn(String.prototype, 'split')
    for (let i = 0; i < 1000; i++) collector.capture('error', failure)
    const stackSplits = split.mock.contexts.filter(context => String(context).startsWith('Error: repeat\n')).length
    split.mockRestore()
    await collector.flush()
    expect(sent[0].body[0]).toMatchObject({ count: 1000 })
    // Fingerprinting reads the first frame each time; compacting the whole stack happens once.
    expect(stackSplits).toBeLessThanOrEqual(1001)
  })

  it('keeps one record within a request body even when JSON escaping inflates its message', () => {
    const base = { occurred_at: 1, app: 'web', release: '2.1.0', env: 'production', kind: 'error', fingerprint: 'abcd1234abcd1234', count: 1, session_id: 's', properties: { sources: ['global'] } } as const
    for (const character of ['\u0001', '"', '\\']) {
      const bodies = chunkBodies([{ ...base, message: character.repeat(16 * 1024) }])
      expect(bodies).toHaveLength(1)
      expect(new TextEncoder().encode(bodies[0]).length).toBeLessThanOrEqual(60 * 1024)
    }
    const [record] = JSON.parse(chunkBodies([{ ...base, message: '\u0001'.repeat(16 * 1024) }])[0])
    expect(record.properties).toMatchObject({ message_truncated: true, sources: ['global'] })
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

  it('binds identity when an error is captured, so an account switch before delivery cannot move it', async () => {
    let userId = 1001
    const { collector, sent } = make({ getContext: () => ({ userId, deviceId: 'dev-1' }) })
    const failure = new Error('stale data')
    collector.capture('error', failure)
    userId = 2002
    await collector.flush()
    expect(sent[0].body).toMatchObject([{ message: 'stale data', user_id: '1001', count: 1 }])
    // The same error under another account is a separate record with its own count.
    collector.capture('error', failure)
    collector.capture('error', failure)
    userId = 1001
    collector.capture('error', failure)
    await collector.flush(true)
    const byUser = Object.fromEntries(sent[1].body.map(record => [record.user_id, record]))
    expect(byUser['2002']).toMatchObject({ count: 2, properties: { session_count: 2 } })
    expect(byUser['1001']).toMatchObject({ count: 1, properties: { session_count: 2 } })
  })

  it('keeps capturing when identity cannot be read', async () => {
    const { collector, sent } = make({
      getContext: () => {
        throw new Error('cookies unavailable')
      }
    })
    collector.capture('error', new Error('still recorded'))
    await collector.flush()
    expect(sent[0].body[0]).toMatchObject({ message: 'still recorded' })
    expect(sent[0].body[0].user_id).toBeUndefined()
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
