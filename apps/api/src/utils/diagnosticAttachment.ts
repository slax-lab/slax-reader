import { SignJWT, jwtVerify } from 'jose'
import { DIAGNOSTIC_ATTACHMENT_MAX_BYTES, DIAGNOSTIC_CONTENT_TYPE, DIAGNOSTIC_DOWNLOAD_TTL_SECONDS } from '@slax-reader/contracts/feedback'
import { SaveReportError } from '@/const/err'

export const DIAGNOSTIC_DOWNLOAD_PATH = '/v1/diagnostics/download'
const audience = 'slax-reader:diagnostic-download'
const purpose = 'diagnostic-download'
const issuer = 'slax-reader'
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'

export interface DiagnosticAttachment {
  id: string
  key: string
  filename: string
  user_id: number
  bytes: number
  created_at: string
  expires_at: string
}

export function diagnosticMetadata(extra: unknown, userId: number): DiagnosticAttachment | null {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null
  const value = (extra as { diagnostic_log?: unknown }).diagnostic_log
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const attachment = value as DiagnosticAttachment
  if (!Number.isSafeInteger(userId) || userId < 1 || attachment.user_id !== userId || !new RegExp(`^${uuid}$`).test(attachment.id)) return null
  if (attachment.key !== `diagnostics/${userId}/${attachment.id}.ndjson` || attachment.filename !== `diagnostic-${attachment.id}.ndjson`) return null
  if (!Number.isSafeInteger(attachment.bytes) || attachment.bytes < 1 || attachment.bytes > DIAGNOSTIC_ATTACHMENT_MAX_BYTES) return null
  const created = Date.parse(attachment.created_at),
    expires = Date.parse(attachment.expires_at)
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires - created !== DIAGNOSTIC_DOWNLOAD_TTL_SECONDS * 1000) return null
  return attachment
}

function configuration(env: Env) {
  if (!env.DIAGNOSTICS || !env.DIAGNOSTIC_DOWNLOAD_SECRET || new TextEncoder().encode(env.DIAGNOSTIC_DOWNLOAD_SECRET).length < 32) throw SaveReportError()
  let origin: URL
  try {
    origin = new URL(env.BACKEND_API_PREFIX)
  } catch {
    throw SaveReportError()
  }
  if (
    (origin.protocol !== 'https:' && !(env.RUN_ENV === 'development' && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  )
    throw SaveReportError()
  return { bucket: env.DIAGNOSTICS, secret: new TextEncoder().encode(env.DIAGNOSTIC_DOWNLOAD_SECRET), origin }
}

export async function uploadDiagnostic(env: Env, userId: number, bytes: Uint8Array): Promise<DiagnosticAttachment> {
  const { bucket } = configuration(env)
  if (!Number.isSafeInteger(userId) || userId < 1 || !bytes.length || bytes.length > DIAGNOSTIC_ATTACHMENT_MAX_BYTES) throw SaveReportError()
  const id = crypto.randomUUID(),
    now = Math.floor(Date.now() / 1000) * 1000
  const metadata: DiagnosticAttachment = {
    id,
    key: `diagnostics/${userId}/${id}.ndjson`,
    filename: `diagnostic-${id}.ndjson`,
    user_id: userId,
    bytes: bytes.length,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + DIAGNOSTIC_DOWNLOAD_TTL_SECONDS * 1000).toISOString()
  }
  try {
    const object = await bucket.put(metadata.key, bytes, {
      httpMetadata: { contentType: DIAGNOSTIC_CONTENT_TYPE },
      customMetadata: { owner: String(userId), attachment: id, expires: metadata.expires_at }
    })
    if (!object) throw SaveReportError()
  } catch {
    throw SaveReportError()
  }
  return metadata
}

export async function diagnosticDownloadUrl(env: Env, reportId: number, attachment: DiagnosticAttachment): Promise<string> {
  const { secret, origin } = configuration(env)
  const token = await new SignJWT({ purpose, attachment: attachment.id, owner: attachment.user_id })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(String(reportId))
    .setJti(attachment.id)
    .setIssuedAt(Math.floor(Date.parse(attachment.created_at) / 1000))
    .setExpirationTime(Math.floor(Date.parse(attachment.expires_at) / 1000))
    .sign(secret)
  const url = new URL(DIAGNOSTIC_DOWNLOAD_PATH, origin)
  url.searchParams.set('token', token)
  return url.toString()
}

export const diagnosticResponseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
}

export async function downloadDiagnostic(
  env: Env,
  request: Request,
  findReport: (id: number) => Promise<{ id: number; user_id: number; extra_data: unknown } | null>,
  requireActiveUser: (id: number) => Promise<void>
): Promise<Response> {
  const unavailable = () => new Response('Diagnostic attachment unavailable', { status: 404, headers: diagnosticResponseHeaders })
  try {
    const { bucket, secret } = configuration(env)
    const query = new URL(request.url).searchParams
    const token = query.get('token')
    if (!token || token.length > 2048 || query.getAll('token').length !== 1 || [...query.keys()].some(key => key !== 'token')) return unavailable()
    const { payload } = await jwtVerify(token, secret, { issuer, audience, algorithms: ['HS256'], typ: 'JWT', requiredClaims: ['exp', 'iat', 'sub', 'jti'] })
    if (payload.purpose !== purpose || typeof payload.sub !== 'string' || !/^[1-9]\d*$/.test(payload.sub) || !Number.isSafeInteger(Number(payload.sub))) return unavailable()
    const report = await findReport(Number(payload.sub))
    if (!report || report.id !== Number(payload.sub) || report.user_id !== payload.owner) return unavailable()
    const attachment = diagnosticMetadata(report.extra_data, report.user_id)
    if (
      !attachment ||
      attachment.id !== payload.attachment ||
      attachment.id !== payload.jti ||
      payload.iat !== Date.parse(attachment.created_at) / 1000 ||
      payload.exp !== Date.parse(attachment.expires_at) / 1000 ||
      Date.now() >= Date.parse(attachment.expires_at)
    )
      return unavailable()
    await requireActiveUser(report.user_id)
    const object = await bucket.get(attachment.key)
    if (!object || object.size !== attachment.bytes) {
      await object?.body.cancel().catch(() => {})
      return unavailable()
    }
    return new Response(object.body, {
      headers: {
        ...diagnosticResponseHeaders,
        'Content-Type': DIAGNOSTIC_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${attachment.filename}"`,
        'Content-Length': String(attachment.bytes)
      }
    })
  } catch {
    return unavailable()
  }
}

export async function removeDiagnosticObjects(env: Pick<Env, 'DIAGNOSTICS'> | undefined, reports: { user_id: number; extra_data: unknown }[]): Promise<void> {
  const attachments = reports.map(report => diagnosticMetadata(report.extra_data, report.user_id)).filter((item): item is DiagnosticAttachment => item !== null)
  if (!attachments.length) return
  if (!env?.DIAGNOSTICS) throw new Error('Diagnostic attachment cleanup unavailable')
  for (let offset = 0; offset < attachments.length; offset += 1000) await env.DIAGNOSTICS.delete(attachments.slice(offset, offset + 1000).map(item => item.key))
}
