import assert from 'node:assert/strict'
import { SignJWT } from 'jose'

export async function exerciseDiagnosticFeedback(
  fetch: (path: string, options?: RequestInit) => Promise<Response>,
  headers: Record<string, string>,
  sql: (query: string) => string,
  secret: string,
  logs: () => string,
  missingObject: (key: string) => Promise<boolean>
) {
  const requestReport = { content: 'Disposable diagnostic feedback', type: 'bug', platform: 'app', entry_point: 'inbox', attach_diagnostic_log: true }
  const ts = new Date().toISOString()
  const launch = { v: 1, ts, event: 'app.launch', app: '1.0.0 (795)', os: 'iOS 26.1', src: 'app', launch: 'abcd1234' }
  const signout = { v: 1, ts, event: 'auth.signout', src: 'app', launch: 'abcd1234', cause: 'user' }
  const raw = [launch, { ...signout, forbidden: 'PRIVATE_SENTINEL' }].map(entry => JSON.stringify(entry)).join('\n') + '\n'
  const expected = [launch, signout].map(entry => JSON.stringify(entry)).join('\n') + '\n'
  const makeBody = async (report: unknown = requestReport) => {
    const form = new FormData()
    form.append('report', JSON.stringify(report))
    form.append('diagnostic_log', new Blob([raw]), '../../unsafe.exe')
    const serialized = new Request('http://fixture.invalid', { method: 'POST', body: form })
    const body = Buffer.from(await serialized.arrayBuffer())
    return {
      method: 'POST',
      headers: { Authorization: headers.Authorization, 'Content-Type': serialized.headers.get('content-type')!, 'Content-Length': String(body.length) },
      body
    }
  }
  const rejected = await fetch('/v1/user/report', await makeBody({ ...requestReport, attach_diagnostic_log: false }))
  assert.equal(rejected.status, 400)
  assert.equal(sql('SELECT count(*) FROM sr_user_report WHERE user_id=1'), '0')
  const upload = await fetch('/v1/user/report', await makeBody())
  const responseText = await upload.text()
  assert.equal(upload.status, 200, responseText.slice(0, 1000))
  const accepted = JSON.parse(responseText) as { code: number; data: unknown }
  assert.equal(accepted.data, 'ok')
  const stored = JSON.parse(sql('SELECT row_to_json(r) FROM (SELECT id,user_id,extra_data FROM sr_user_report WHERE user_id=1 ORDER BY id DESC LIMIT 1) r'))
  const metadata = stored.extra_data.diagnostic_log
  assert.equal(metadata.user_id, 1)
  assert.equal(metadata.bytes, Buffer.byteLength(expected))
  assert.match(metadata.filename, /^diagnostic-[a-f0-9-]+\.ndjson$/)
  let url = ''
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch('/__fixture/diagnostic-notifications', { headers })
    const messages = (await response.json()) as string[]
    if (messages.length) {
      const card = JSON.parse(messages[0]).card.elements[0].text.content as string
      url = /\[Download diagnostic log\]\(([^)]+)\)/.exec(card)?.[1] || ''
      if (url) break
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(url, 'Captured notification must include trusted diagnostic link')
  const target = new URL(url),
    path = target.pathname + target.search
  assert.equal(target.pathname, '/v1/diagnostics/download')
  const downloaded = await fetch(path)
  assert.equal(downloaded.status, 200)
  const downloadedBytes = Buffer.from(await downloaded.arrayBuffer())
  assert.deepEqual(downloadedBytes, Buffer.from(expected))
  assert.equal(downloadedBytes.length, metadata.bytes)
  assert.deepEqual(
    downloadedBytes
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map(line => JSON.parse(line)),
    [launch, signout]
  )
  assert.equal(downloaded.headers.get('content-disposition'), `attachment; filename="${metadata.filename}"`)
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(downloaded.headers.get('referrer-policy'), 'no-referrer')
  assert.ok(downloaded.headers.get('cache-control')?.includes('no-store'))
  const forged = path.slice(0, -5) + 'false'
  assert.equal((await fetch(forged)).status, 404)
  const expired = await new SignJWT({ purpose: 'diagnostic-download', owner: 1, attachment: metadata.id })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('slax-reader')
    .setAudience('slax-reader:diagnostic-download')
    .setSubject(String(stored.id))
    .setJti(metadata.id)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 604801)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
    .sign(new TextEncoder().encode(secret))
  assert.equal((await fetch('/v1/diagnostics/download?token=' + expired)).status, 404)
  const legacy = await fetch('/v1/user/report', { method: 'POST', headers, body: JSON.stringify({ ...requestReport, attach_diagnostic_log: false }) })
  assert.equal(legacy.status, 200)
  await fetch('/__fixture/diagnostic-notification-failure', { headers })
  const notificationFailure = await fetch('/v1/user/report', await makeBody())
  assert.equal(notificationFailure.status, 200)
  assert.equal(sql('SELECT count(*) FROM sr_user_report WHERE user_id=1'), '3')
  assert.equal(sql("SELECT count(*) FROM sr_user_report WHERE user_id=1 AND extra_data ? 'diagnostic_log'"), '2')
  const reportQuery = 'SELECT json_agg(r ORDER BY id) FROM (SELECT * FROM sr_user_report WHERE user_id=1) r'
  const reportsBeforeDeletion = sql(reportQuery)
  const deleted = await fetch('/v1/user/delete_my_account', { method: 'POST', headers, body: '{}' })
  assert.equal(deleted.status, 200)
  assert.equal(((await deleted.json()) as { data: { canDelete: boolean } }).data.canDelete, true)
  assert.equal((await fetch(path)).status, 404)
  assert.equal(sql(reportQuery), reportsBeforeDeletion)
  assert.equal(sql("SELECT count(*) FROM sr_user_report WHERE user_id=1 AND NOT (extra_data ? 'diagnostic_log')"), '1')
  assert.equal(await missingObject(metadata.key), true)
  const unauthorized = await makeBody()
  delete (unauthorized.headers as Record<string, string>).Authorization
  assert.equal((await fetch('/v1/user/report', unauthorized)).status, 401)
  assert.equal(sql(reportQuery), reportsBeforeDeletion)
  assert.ok(!logs().includes(target.searchParams.get('token')!))
  assert.ok(!logs().includes('PRIVATE_SENTINEL'))
  return {
    upload: 'accepted after persistence',
    bytes: metadata.bytes,
    notification: 'captured only; failure acknowledged without duplicates',
    download: 'anonymous identical sanitized bytes and protected headers',
    rejected: ['consent', 'unauthenticated', 'forged', 'expired', 'deleted'],
    deletion: 'account revoked, ordinary and diagnostic feedback rows unchanged, R2 object absent',
    privacy: 'no token or rejected raw fields in worker logs'
  }
}
