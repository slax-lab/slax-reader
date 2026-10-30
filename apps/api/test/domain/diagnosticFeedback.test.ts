import { afterEach, describe, expect, test, vi } from 'vitest'
import { SignJWT } from 'jose'
import { UserService, reportEntryPoint, reportPlatform } from '@/domain/user'
import { UserController } from '@/handler/http/userController'
import { reportType } from '@/infra/repository/dbReport'
import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { DIAGNOSTIC_DOWNLOAD_PATH, diagnosticDownloadUrl, downloadDiagnostic, removeDiagnosticObjects, uploadDiagnostic } from '@/utils/diagnosticAttachment'
import { DIAGNOSTIC_DOWNLOAD_TTL_SECONDS } from '@slax-reader/contracts/feedback'
import { isWhitelisted, auth } from '@/middleware/auth'
import { Container } from '@/decorators/di'
import { rateLimit } from '@/middleware/rateLimit'
import { requestLog } from '@/middleware/requestLog'
import { UserDeletionService } from '@/domain/userDeletion'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const bytes = new TextEncoder().encode('{"v":1,"event":"snapshot","ts":"2026-10-29T00:00:00.000Z","sync":{},"session":"authenticated"}\n')
const report = { user_id: 7, content: 'Test feedback', type: reportType.BUG, platform: reportPlatform.APP, entry_point: reportEntryPoint.INBOX }
function fixture() {
  const order: string[] = [],
    pending: Promise<unknown>[] = [],
    objects = new Map<string, Uint8Array>()
  const bucket = {
    put: vi.fn(async (key: string, value: Uint8Array) => {
      order.push('upload')
      objects.set(key, value)
      return { key }
    }),
    get: vi.fn(async (key: string) => {
      const content = objects.get(key)
      return content ? { size: content.length, body: new Response(content).body! } : null
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      order.push('delete')
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
    })
  }
  const env = {
    DIAGNOSTICS: bucket,
    DIAGNOSTIC_DOWNLOAD_SECRET: 'fixture-only-signing-secret-32-characters',
    BACKEND_API_PREFIX: 'https://api.fixture.test',
    RUN_ENV: 'prod',
    RUN_TYPE: 'beta',
    REPORT_PUSH_API: 'https://notification.fixture.test/capture',
    HASH_IDS_SALT: 'diagnostics-fixture'
  } as unknown as Env
  const ctx = new ContextManager({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as ExecutionContext, env)
  ctx.setUserInfo(7, 123, 'fixture@example.test', 'en')
  ctx.setHashIds(new Hashid(env, 7))
  let stored: any = null,
    card = ''
  const repository = {
    saveReport: vi.fn(async (row: any) => {
      order.push('persist')
      stored = { id: 42, user_id: row.user_id, created_at: new Date(), extra_data: { diagnostic_log: row.diagnostic_log } }
      return stored
    }),
    getByDiagnostic: vi.fn(async () => stored),
    getReportDetail: vi.fn(async () => stored)
  }
  const user = { requireActiveUser: vi.fn(async () => {}), getInfoByUserId: vi.fn(async () => ({ name: 'Fixture', email: 'fixture@example.test', country: '' })) }
  const fetchMock = vi.fn(async (_url, options) => {
    order.push('notify')
    card = String(options.body)
    return new Response(card)
  })
  vi.stubGlobal('fetch', fetchMock)
  const service = new UserService(
    user as never,
    {} as never,
    repository as never,
    {} as never,
    {} as never,
    { getBookmarkById: vi.fn().mockResolvedValue(null) } as never,
    {} as never,
    { trackEvent: vi.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never
  )
  const controller = new UserController(service, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  return { bucket, env, ctx, service, controller, repository, user, order, pending, objects, fetchMock, stored: () => stored, card: () => card }
}

describe('durable diagnostic feedback', () => {
  test('authenticated upload persists before captured notification and downloads identical bytes anonymously', async () => {
    const f = fixture(),
      log = vi.spyOn(console, 'log').mockImplementation(() => {}),
      error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await f.service.saveReport(f.ctx, report, bytes)
    expect(f.stored()).not.toBeNull()
    await Promise.all(f.pending)
    expect(f.order).toEqual(['upload', 'persist', 'notify'])
    const metadata = f.stored().extra_data.diagnostic_log
    expect(metadata.filename).toMatch(/^diagnostic-[a-f0-9-]+\.ndjson$/)
    const content = JSON.parse(f.card()).card.elements[0].text.content as string
    const url = /\[Download diagnostic log\]\(([^)]+)\)/.exec(content)![1]
    expect(url).toMatch(/^https:\/\/api\.fixture\.test\/v1\/diagnostics\/download\?token=/)
    expect(content).toContain(metadata.expires_at)
    expect(content.startsWith(`[Download diagnostic log](${url})\nExpires: `)).toBe(true)
    expect(content.indexOf(report.content)).toBeGreaterThan(content.indexOf(metadata.expires_at))
    const request = new Request(url)
    const response = await f.service.downloadDiagnostic(f.ctx, request)
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get('content-type')).toBe('application/x-ndjson')
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${metadata.filename}"`)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(isWhitelisted(new URL(url).pathname)).toBe(true)
    const anonymous = new ContextManager({ waitUntil: () => {} } as unknown as ExecutionContext, f.env)
    await expect(auth(request, anonymous, new Container())).resolves.toBeUndefined()
    requestLog(request, anonymous)
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain(new URL(url).searchParams.get('token'))
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain(url)
  })
  test('legacy response shape unchanged without upload configuration', async () => {
    const f = fixture()
    delete f.env.DIAGNOSTICS
    delete f.env.DIAGNOSTIC_DOWNLOAD_SECRET
    const response = await f.controller.handleUserReportRequest(f.ctx, new Request('https://api.fixture.test/v1/user/report', { method: 'POST', body: JSON.stringify(report) }))
    expect(await response.json()).toMatchObject({ code: 200, data: 'ok' })
    await Promise.all(f.pending)
    expect(f.bucket.put).not.toHaveBeenCalled()
    expect(f.repository.saveReport).toHaveBeenCalledTimes(1)
    expect(f.card()).not.toContain('Download diagnostic')
  })
  test('unauthenticated controller rejects without reading attachment stream', async () => {
    const f = fixture()
    f.ctx.setUserInfo(0, 0, '', '')
    const req = new Request('https://api.fixture.test/v1/user/report', { method: 'POST', body: 'invalid' })
    await expect(f.controller.handleUserReportRequest(f.ctx, req)).rejects.toMatchObject({ errCode: 401 })
    expect(req.bodyUsed).toBe(false)
    expect(f.bucket.put).not.toHaveBeenCalled()
  })
  test.each(['bucket', 'secret', 'short secret', 'origin', 'upload', 'inactive'])('%s failure never accepts report', async mode => {
    const f = fixture()
    if (mode === 'bucket') delete f.env.DIAGNOSTICS
    if (mode === 'secret') delete f.env.DIAGNOSTIC_DOWNLOAD_SECRET
    if (mode === 'short secret') f.env.DIAGNOSTIC_DOWNLOAD_SECRET = 'short'
    if (mode === 'origin') f.env.BACKEND_API_PREFIX = 'https://attacker@api.fixture.test'
    if (mode === 'upload') f.bucket.put.mockRejectedValueOnce(new Error('storage failure private data'))
    if (mode === 'inactive') f.user.requireActiveUser.mockRejectedValueOnce(new Error('deleted'))
    await expect(f.service.saveReport(f.ctx, report, bytes)).rejects.toThrow()
    expect(f.repository.saveReport).not.toHaveBeenCalled()
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  test('confirmed database failure removes uploaded object and sends no message', async () => {
    const f = fixture()
    f.repository.saveReport.mockRejectedValueOnce(new Error('db rejected'))
    await expect(f.service.saveReport(f.ctx, report, bytes)).rejects.toThrow()
    expect(f.order).toEqual(['upload', 'delete'])
    expect(f.objects.size).toBe(0)
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  test('database outcome unknown does not delete possibly persisted object', async () => {
    const f = fixture()
    f.repository.saveReport.mockRejectedValueOnce(new Error('connection lost'))
    f.repository.getByDiagnostic.mockRejectedValueOnce(new Error('offline'))
    await expect(f.service.saveReport(f.ctx, report, bytes)).rejects.toThrow()
    expect(f.bucket.delete).not.toHaveBeenCalled()
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  test('lost database acknowledgement reconciles existing report without second upload or insert', async () => {
    const f = fixture(),
      save = f.repository.saveReport.getMockImplementation()!
    f.repository.saveReport.mockImplementationOnce(async row => {
      await save(row)
      throw new Error('lost acknowledgement')
    })
    await f.service.saveReport(f.ctx, report, bytes)
    await Promise.all(f.pending)
    expect(f.repository.saveReport).toHaveBeenCalledTimes(1)
    expect(f.bucket.put).toHaveBeenCalledTimes(1)
    expect(f.bucket.delete).not.toHaveBeenCalled()
  })
  test('notification failure retains accepted report with no duplicate upload', async () => {
    const f = fixture()
    f.fetchMock.mockRejectedValueOnce(new Error('webhook private failure'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(f.service.saveReport(f.ctx, report, bytes)).resolves.toBeUndefined()
    await Promise.all(f.pending)
    expect(f.repository.saveReport).toHaveBeenCalledTimes(1)
    expect(f.bucket.put).toHaveBeenCalledTimes(1)
    expect(error.mock.calls).toEqual([['Report notification unavailable: 42']])
  })
  test('multipart upload rate limit uses separate existing limiter key and never parses telemetry body', async () => {
    const f = fixture()
    const limit = vi.fn().mockResolvedValue({ success: false })
    f.env.BOOKMARK_ADD_RATE_LIMITER = { limit }
    const req = new Request('https://api.fixture.test/v1/user/report', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test' }, body: 'private' })
    await expect(rateLimit(req, f.ctx)).rejects.toMatchObject({ errCode: 429 })
    expect(limit).toHaveBeenCalledWith({ key: 'diagnostic:uid:7' })
    expect(req.bodyUsed).toBe(false)
    expect(f.pending).toHaveLength(0)
    await rateLimit(new Request(req.url, { method: 'POST', body: '{}' }), f.ctx)
    expect(limit).toHaveBeenCalledTimes(1)
  })
})

describe('diagnostic capability verification and removal', () => {
  test.each([
    'tampered',
    'expired',
    'purpose',
    'audience',
    'issuer',
    'owner',
    'attachment',
    'subject',
    'metadata',
    'revoked',
    'missing',
    'duplicate token',
    'arbitrary key',
    'size'
  ])('%s rejected without exposing object', async mode => {
    const f = fixture()
    await f.service.saveReport(f.ctx, report, bytes)
    await Promise.all(f.pending)
    const attachment = f.stored().extra_data.diagnostic_log
    const url = new URL(await diagnosticDownloadUrl(f.env, 42, attachment))
    if (mode === 'tampered') {
      const token = url.searchParams.get('token')!
      url.searchParams.set('token', token.slice(0, -5) + 'other')
    }
    if (mode === 'expired') {
      vi.useFakeTimers()
      vi.setSystemTime(Date.parse(attachment.expires_at))
    }
    if (['purpose', 'audience', 'issuer', 'owner', 'attachment', 'subject'].includes(mode)) {
      const token = await new SignJWT({
        purpose: mode === 'purpose' ? 'auth' : 'diagnostic-download',
        owner: mode === 'owner' ? 8 : 7,
        attachment: mode === 'attachment' ? 'unrelated' : attachment.id
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(mode === 'issuer' ? 'other' : 'slax-reader')
        .setAudience(mode === 'audience' ? 'auth' : 'slax-reader:diagnostic-download')
        .setSubject(mode === 'subject' ? '999' : '42')
        .setJti(attachment.id)
        .setIssuedAt(Date.parse(attachment.created_at) / 1000)
        .setExpirationTime(Date.parse(attachment.expires_at) / 1000)
        .sign(new TextEncoder().encode(f.env.DIAGNOSTIC_DOWNLOAD_SECRET))
      url.searchParams.set('token', token)
    }
    if (mode === 'metadata') attachment.key = 'another/account/object'
    if (mode === 'revoked') f.user.requireActiveUser.mockRejectedValue(new Error('deleted'))
    if (mode === 'missing') f.objects.clear()
    if (mode === 'duplicate token') url.searchParams.append('token', url.searchParams.get('token')!)
    if (mode === 'arbitrary key') url.searchParams.append('key', 'unrelated')
    if (mode === 'size') attachment.bytes++
    const response = await f.service.downloadDiagnostic(f.ctx, new Request(url))
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Diagnostic attachment unavailable')
    expect(response.headers.get('cache-control')).toContain('no-store')
    if (!['missing', 'size'].includes(mode)) expect(f.bucket.get).not.toHaveBeenCalled()
  })
  test('seven day expiry independent of physically retained bytes', async () => {
    const f = fixture(),
      metadata = await uploadDiagnostic(f.env, 7, bytes)
    expect(Date.parse(metadata.expires_at) - Date.parse(metadata.created_at)).toBe(DIAGNOSTIC_DOWNLOAD_TTL_SECONDS * 1000)
    const url = await diagnosticDownloadUrl(f.env, 42, metadata)
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse(metadata.expires_at) + 1)
    const response = await downloadDiagnostic(
      f.env,
      new Request(url),
      async () => ({ id: 42, user_id: 7, extra_data: { diagnostic_log: metadata } }),
      async () => {}
    )
    expect(response.status).toBe(404)
    expect(f.objects.size).toBe(1)
    expect(f.bucket.get).not.toHaveBeenCalled()
  })
  test('account cleanup removes diagnostic objects without deleting or changing feedback rows', async () => {
    const f = fixture(),
      metadata = await uploadDiagnostic(f.env, 7, bytes),
      order: string[] = []
    const reports = [
      { user_id: 7, content: 'Ordinary feedback', extra_data: { platform: 'app' } },
      { user_id: 7, content: 'Attached feedback', extra_data: { diagnostic_log: metadata } }
    ]
    const before = structuredClone(reports)
    const pg = {
      sr_user_report: { findMany: vi.fn().mockResolvedValue(reports), deleteMany: vi.fn(), updateMany: vi.fn() },
      $executeRaw: vi.fn(async () => {
        order.push('remaining cleanup')
        throw new Error('stop fixture after diagnostic cleanup')
      })
    }
    f.bucket.delete.mockImplementation(async keys => {
      order.push('objects')
      for (const key of Array.isArray(keys) ? keys : [keys]) f.objects.delete(key)
    })
    const deletion = new UserDeletionService((() => pg) as never, {} as never, {} as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(deletion.cleanupUserData(7, f.env)).rejects.toThrow('stop fixture')
    expect(order).toEqual(['objects', 'remaining cleanup'])
    expect(f.objects.size).toBe(0)
    expect(pg.sr_user_report.findMany).toHaveBeenCalledWith({ where: { user_id: 7 }, select: { user_id: true, extra_data: true } })
    expect(pg.sr_user_report.deleteMany).not.toHaveBeenCalled()
    expect(pg.sr_user_report.updateMany).not.toHaveBeenCalled()
    expect(reports).toEqual(before)
  })
  test('deletion unavailable storage fails for retry rather than losing removal metadata', async () => {
    const f = fixture(),
      metadata = await uploadDiagnostic(f.env, 7, bytes)
    await expect(removeDiagnosticObjects({}, [{ user_id: 7, extra_data: { diagnostic_log: metadata } }])).rejects.toThrow('cleanup unavailable')
    await removeDiagnosticObjects(f.env, [{ user_id: 8, extra_data: { diagnostic_log: metadata } }])
    expect(f.bucket.delete).not.toHaveBeenCalled()
  })
})
