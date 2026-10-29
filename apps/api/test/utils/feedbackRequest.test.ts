import { describe, expect, test } from 'vitest'
import { parseFeedbackRequest, readBoundedBody, sanitizeDiagnosticFile } from '@/utils/feedbackRequest'
import {
  DIAGNOSTIC_ATTACHMENT_MAX_BYTES,
  DIAGNOSTIC_REQUEST_MAX_BYTES,
  DIAGNOSTIC_MULTIPART_OVERHEAD_MAX_BYTES,
  sanitizeDiagnosticExportEntry
} from '@slax-reader/contracts/feedback'

export const snapshot = { v: 1, event: 'snapshot', ts: '2026-10-29T12:00:00.000+08:00', sync: { connected: true, pendingUploads: 0 }, session: 'authenticated' }
const encode = (value: string) => new TextEncoder().encode(value)
const valid = JSON.stringify(snapshot) + '\n'
const report = { content: 'Feedback', type: 'bug', platform: 'app', entry_point: 'inbox', attach_diagnostic_log: true }
function multipart(file: Blob = new Blob([valid]), payload: unknown = report) {
  const form = new FormData()
  form.append('report', JSON.stringify(payload))
  form.append('diagnostic_log', file, '../../untrusted.exe')
  return form
}
const request = (body: FormData) => new Request('https://api.test/v1/user/report', { method: 'POST', body })

describe('feedback report parsing', () => {
  test.each([0, 3, 4096, 4097, 70000])('streamed body returns actual sized backing storage for %s bytes', async size => {
    let offset = 0
    const expected = Uint8Array.from({ length: size }, (_, index) => index % 251)
    const stream = new ReadableStream({
      pull(controller) {
        if (offset === size) {
          controller.close()
          return
        }
        const length = Math.min(size - offset, offset < 4096 ? 1 : 137)
        controller.enqueue(expected.subarray(offset, offset + length))
        offset += length
      }
    })
    const req = new Request('https://api.test/report', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    const result = await readBoundedBody(req, DIAGNOSTIC_REQUEST_MAX_BYTES)
    expect(result).toEqual(expected)
    expect(result.buffer.byteLength).toBe(size)
    expect(result.byteOffset).toBe(0)
  })
  test('incremental chunks respect exact bound and cancel before retaining overflow', async () => {
    for (const extra of [0, 1]) {
      let sent = 0,
        cancelled = false
      const stream = new ReadableStream({
        pull(controller) {
          if (sent === 70000 + extra) {
            controller.close()
            return
          }
          const length = Math.min(113, 70000 + extra - sent)
          controller.enqueue(new Uint8Array(length))
          sent += length
        },
        cancel() {
          cancelled = true
        }
      })
      const req = new Request('https://api.test/report', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
      if (extra) {
        await expect(readBoundedBody(req, 70000)).rejects.toThrow()
        expect(cancelled).toBe(true)
      } else {
        const bytes = await readBoundedBody(req, 70000)
        expect(bytes.buffer.byteLength).toBe(70000)
        expect(cancelled).toBe(false)
      }
    }
  })
  test.each([1, 600])('sanitized output backing storage matches actual bytes for %s records', count => {
    const line = JSON.stringify({ v: 1, ts: snapshot.ts, src: 'app', event: 'app.launch' }) + '\n'
    const result = sanitizeDiagnosticFile(encode(valid + line.repeat(count)))
    expect(result.buffer.byteLength).toBe(result.byteLength)
    expect(result.byteOffset).toBe(0)
    expect(result.byteLength).toBeLessThan(100000)
    expect(new TextDecoder().decode(result).split('\n')).toHaveLength(count + 2)
  })
  test('legacy JSON remains unchanged without attachment; false also does not export', async () => {
    for (const value of [
      { ...report, attach_diagnostic_log: undefined },
      { ...report, attach_diagnostic_log: false }
    ]) {
      const body = JSON.stringify(value)
      expect(await parseFeedbackRequest(new Request('https://api.test/v1/user/report', { method: 'POST', body }))).toEqual({ report: JSON.parse(body) })
    }
  })
  test.each([true, 'true', 1, null])('JSON cannot claim an attachment (%s)', async consent => {
    await expect(
      parseFeedbackRequest(new Request('https://api.test/v1/user/report', { method: 'POST', body: JSON.stringify({ ...report, attach_diagnostic_log: consent }) }))
    ).rejects.toThrow()
  })
  test.each(['attach_diagnostic_log', 'attach_diagnostic_\\u006cog'])('duplicate consent property %s is rejected before JSON last-key wins', async key => {
    const raw = JSON.stringify(report).slice(0, -1) + `,"${key}":false}`
    await expect(parseFeedbackRequest(new Request('https://api.test/v1/user/report', { method: 'POST', body: raw }))).rejects.toThrow()
    const form = multipart()
    form.set('report', raw.replace(/false}$/, 'true}'))
    await expect(parseFeedbackRequest(request(form))).rejects.toThrow()
  })
  test('valid consented snapshot ignores filename MIME and untrusted extra fields', async () => {
    const raw = {
      ...snapshot,
      password: 'secret',
      sync: { ...snapshot.sync, body: 'sensitive', uploadError: { class: 'TypeError', message: 'secret path' } },
      network: { type: 'WIFI', ssid: 'private network' }
    }
    const result = await parseFeedbackRequest(request(multipart(new Blob([JSON.stringify(raw) + '\n'], { type: 'image/jpeg' }))))
    expect(result.report).toEqual(report)
    const text = new TextDecoder().decode(result.diagnostic)
    expect(text).toContain('TypeError')
    expect(text).not.toMatch(/secret|sensitive|private network|ssid|password|message/)
  })
  test.each([
    'missing consent',
    'false consent',
    'missing file',
    'duplicate file',
    'duplicate report',
    'unknown field',
    'file report',
    'text file',
    'invalid report',
    'empty content',
    'invalid type'
  ])('%s rejected', async scenario => {
    const form = multipart()
    if (scenario === 'missing consent') form.set('report', JSON.stringify({ ...report, attach_diagnostic_log: undefined }))
    if (scenario === 'false consent') form.set('report', JSON.stringify({ ...report, attach_diagnostic_log: false }))
    if (scenario === 'missing file') form.delete('diagnostic_log')
    if (scenario === 'duplicate file') form.append('diagnostic_log', new Blob([valid]), 'extra.ndjson')
    if (scenario === 'duplicate report') form.append('report', JSON.stringify(report))
    if (scenario === 'unknown field') form.append('key', 'private/object')
    if (scenario === 'file report') form.set('report', new Blob([JSON.stringify(report)]), 'report.json')
    if (scenario === 'text file') form.set('diagnostic_log', valid)
    if (scenario === 'invalid report') form.set('report', '{')
    if (scenario === 'empty content') form.set('report', JSON.stringify({ ...report, content: '' }))
    if (scenario === 'invalid type') form.set('report', JSON.stringify({ ...report, type: {} }))
    await expect(parseFeedbackRequest(request(form))).rejects.toThrow()
  })
  test.each(['', '\n', '{}\n', '[]\n', '{bad}\n', valid + '\n', valid + '{"v":1,"event":"anything"}\n', valid + valid, '\u0000'])('invalid NDJSON rejected: %j', async raw => {
    await expect(parseFeedbackRequest(request(multipart(new Blob([raw]))))).rejects.toThrow()
  })
  test('malformed UTF8 and binary uploads are rejected', async () => {
    await expect(parseFeedbackRequest(request(multipart(new Blob([new Uint8Array([0xff, 0xfe, 0])]))))).rejects.toThrow()
  })
  test('unsupported record source and event shape rejected', () => {
    for (const item of [
      { v: 1, ts: snapshot.ts, event: 'auth.login', src: 'app', ok: 'yes' },
      { v: 1, ts: snapshot.ts, event: 'share.end', src: 'app' },
      { v: 1, ts: snapshot.ts, event: 'auth.signout', src: 'app', cause: 'token goes here' }
    ])
      expect(sanitizeDiagnosticExportEntry(item)).toBeNull()
  })
  test('sensitive event fields are removed or reduced', () => {
    const result = sanitizeDiagnosticExportEntry({
      v: 1,
      ts: snapshot.ts,
      event: 'auth.login',
      src: 'app',
      provider: 'apple',
      ok: false,
      credentials: 'private',
      http: { path: '/v1/user/login?token=private', method: 'POST', status: 401, body: 'private' },
      headers: {
        request: { Authorization: 'Bearer private', Cookie: 'private', 'User-Agent': 'private', 'Content-Type': 'application/json' },
        response: { 'Set-Cookie': 'private', 'CF-Ray': '1234567890abcdef-SJC' }
      }
    })
    expect(JSON.stringify(result)).not.toMatch(/private|credentials|Cookie|User-Agent/)
    expect(result!.http).toMatchObject({ path: '[redacted]', status: 401 })
  })
  test('snapshot-only and app/share records retain allowed metadata', () => {
    const entries = [
      snapshot,
      { v: 1, ts: snapshot.ts, src: 'app', event: 'auth.signout', cause: 'user' },
      {
        v: 1,
        ts: snapshot.ts,
        src: 'share-ios',
        share: 'abcd1234',
        event: 'share.end',
        outcome: 'failed',
        reason: 'network_tls',
        stage: 'request',
        token: { present: true, len: 5, tail4: 'abcd', value: 'secret' },
        input: { url: { scheme: 'https', host: 'example.com', length: 45, path: '/secret' }, title: true },
        net: { dns: 12, tls: 15, failedIn: 'tls', remoteAddress: 'private' }
      }
    ]
    const text = new TextDecoder().decode(sanitizeDiagnosticFile(encode(entries.map(entry => JSON.stringify(entry)).join('\n'))))
    expect(text).toContain('network_tls')
    expect(text).toContain('example.com')
    expect(text).not.toMatch(/secret|private|remoteAddress/)
  })
  test('exact file cap accepted; cap plus one rejected', async () => {
    const line = JSON.stringify({ v: 1, ts: snapshot.ts, src: 'app', event: 'app.launch' }) + '\n'
    const canonical = JSON.stringify(sanitizeDiagnosticExportEntry(snapshot)) + '\n'
    const prefix = canonical + line.repeat(Math.floor((DIAGNOSTIC_ATTACHMENT_MAX_BYTES - canonical.length) / line.length))
    const remaining = DIAGNOSTIC_ATTACHMENT_MAX_BYTES - prefix.length
    const exact = prefix.slice(0, -1) + ' '.repeat(remaining) + '\n'
    expect(encode(exact).length).toBe(DIAGNOSTIC_ATTACHMENT_MAX_BYTES)
    expect((await parseFeedbackRequest(request(multipart(new Blob([exact]))))).diagnostic!.length).toBeLessThanOrEqual(DIAGNOSTIC_ATTACHMENT_MAX_BYTES)
    await expect(parseFeedbackRequest(request(multipart(new Blob([exact + ' ']))))).rejects.toThrow()
  })
  test('multipart overhead exact cap accepted and cap plus one rejected', async () => {
    const original = request(multipart())
    const body = new Uint8Array(await original.arrayBuffer())
    const overhead = body.length - encode(valid).length
    const raw = new TextDecoder().decode(body)
    const padding = ' '.repeat(DIAGNOSTIC_MULTIPART_OVERHEAD_MAX_BYTES - overhead)
    for (const extra of [0, 1]) {
      const input = new Request(original.url, {
        method: 'POST',
        headers: original.headers,
        body: raw.replace(JSON.stringify(report), JSON.stringify(report) + padding + ' '.repeat(extra))
      })
      if (extra) await expect(parseFeedbackRequest(input)).rejects.toThrow()
      else expect((await parseFeedbackRequest(input)).diagnostic!.length).toBeGreaterThan(0)
    }
  })
  test.each([undefined, '1', String(DIAGNOSTIC_REQUEST_MAX_BYTES)])('actual streamed total bounded despite length %s', async length => {
    let cancelled = false
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(DIAGNOSTIC_REQUEST_MAX_BYTES))
        controller.enqueue(new Uint8Array(1))
      },
      cancel() {
        cancelled = true
      }
    })
    const req = new Request('https://api.test/report', { method: 'POST', headers: length ? { 'Content-Length': length } : {}, body: stream, duplex: 'half' } as RequestInit)
    await expect(readBoundedBody(req, DIAGNOSTIC_REQUEST_MAX_BYTES)).rejects.toThrow()
    expect(cancelled).toBe(true)
  })
})
