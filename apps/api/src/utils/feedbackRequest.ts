import {
  DIAGNOSTIC_ATTACHMENT_MAX_BYTES,
  DIAGNOSTIC_EXPORT_LINE_MAX_BYTES,
  DIAGNOSTIC_MULTIPART_OVERHEAD_MAX_BYTES,
  DIAGNOSTIC_REQUEST_MAX_BYTES,
  DIAGNOSTIC_REPORT_FIELD,
  DIAGNOSTIC_FILE_FIELD,
  sanitizeDiagnosticExportEntry,
  type FeedbackReportRequest
} from '@slax-reader/contracts/feedback'
import { ErrorParam } from '@/const/err'

class BoundedBytes {
  private blocks: Uint8Array[] = []
  private current = new Uint8Array(0)
  private used = 0
  public size = 0

  constructor(private limit: number) {}

  append(value: Uint8Array): void {
    if (value.byteLength > this.limit - this.size) throw ErrorParam()
    let offset = 0
    while (offset < value.byteLength) {
      if (this.used === this.current.length) {
        if (this.current.length) this.blocks.push(this.current)
        this.current = new Uint8Array(Math.min(this.size === 0 ? 4096 : 65536, this.limit - this.size))
        this.used = 0
      }
      const length = Math.min(value.byteLength - offset, this.current.length - this.used)
      this.current.set(value.subarray(offset, offset + length), this.used)
      this.used += length
      this.size += length
      offset += length
    }
  }

  finish(): Uint8Array {
    if (!this.blocks.length) return this.used === this.current.length ? this.current : this.current.slice(0, this.used)
    const result = new Uint8Array(this.size)
    let offset = 0
    for (const block of this.blocks) {
      result.set(block, offset)
      offset += block.length
    }
    result.set(this.current.subarray(0, this.used), offset)
    return result
  }
}

export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader()
  if (!reader) throw ErrorParam()
  const output = new BoundedBytes(limit)
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value.byteLength > limit - output.size) {
        await reader.cancel().catch(() => {})
        throw ErrorParam()
      }
      output.append(value)
    }
  } finally {
    reader.releaseLock()
  }
  return output.finish()
}

export function sanitizeDiagnosticFile(bytes: Uint8Array): Uint8Array {
  if (!bytes.length || bytes.length > DIAGNOSTIC_ATTACHMENT_MAX_BYTES) throw ErrorParam()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  const encoder = new TextEncoder(),
    output = new BoundedBytes(DIAGNOSTIC_ATTACHMENT_MAX_BYTES)
  let start = 0,
    count = 0
  for (let offset = 0; offset <= bytes.length; offset++) {
    if (offset < bytes.length && bytes[offset] !== 10) continue
    if (offset === bytes.length && start === offset) break
    if (offset - start + 1 > DIAGNOSTIC_EXPORT_LINE_MAX_BYTES) throw ErrorParam()
    let entry
    try {
      const line = decoder.decode(bytes.subarray(start, offset))
      if (!line.trim() || line.includes('\u0000')) throw ErrorParam()
      entry = sanitizeDiagnosticExportEntry(JSON.parse(line))
    } catch {
      throw ErrorParam()
    }
    if (!entry || (count > 0 && entry.event === 'snapshot')) throw ErrorParam()
    const sanitized = encoder.encode(JSON.stringify(entry) + '\n')
    if (sanitized.length > DIAGNOSTIC_EXPORT_LINE_MAX_BYTES) throw ErrorParam()
    output.append(sanitized)
    count++
    start = offset + 1
  }
  if (!count) throw ErrorParam()
  return output.finish()
}

function parseReportJson(text: string): unknown {
  const value = JSON.parse(text)
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]:,]/g
  let depth = 0,
    consent = 0
  for (const match of text.matchAll(tokens)) {
    const token = match[0]
    if (token === '{' || token === '[') depth++
    else if (token === '}' || token === ']') depth--
    else if (
      depth === 1 &&
      token.startsWith('"') &&
      text
        .slice(match.index! + token.length)
        .trimStart()
        .startsWith(':') &&
      JSON.parse(token) === 'attach_diagnostic_log'
    )
      consent++
  }
  if (consent > 1) throw ErrorParam()
  return value
}

function parseReport(value: unknown, multipart: boolean): FeedbackReportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw ErrorParam()
  const report = value as FeedbackReportRequest
  if (multipart ? report.attach_diagnostic_log !== true : report.attach_diagnostic_log !== undefined && report.attach_diagnostic_log !== false) throw ErrorParam()
  if (multipart) {
    if (typeof report.content !== 'string' || !report.content.trim() || !['parse_error', 'loss_function', 'like', 'bug', 'other'].includes(report.type)) throw ErrorParam()
    for (const key of ['share_code', 'collection_code', 'bookmark_uuid', 'environment', 'version', 'target_url'] as const) {
      if (report[key] !== undefined && typeof report[key] !== 'string') throw ErrorParam()
    }
    for (const key of ['bookmark_id', 'cb_id'] as const) if (report[key] !== undefined && (!Number.isSafeInteger(report[key]) || report[key]! < 1)) throw ErrorParam()
    if (report.allow_follow_up !== undefined && typeof report.allow_follow_up !== 'boolean') throw ErrorParam()
  }
  return report
}

export async function parseFeedbackRequest(request: Request): Promise<{ report: FeedbackReportRequest; diagnostic?: Uint8Array }> {
  const contentType = request.headers.get('content-type') || ''
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    let report
    try {
      report = parseReportJson(await request.text())
    } catch {
      throw ErrorParam()
    }
    return { report: parseReport(report, false) }
  }
  const bytes = await readBoundedBody(request, DIAGNOSTIC_REQUEST_MAX_BYTES)
  let form: FormData
  try {
    form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData()
  } catch {
    throw ErrorParam()
  }
  const reports = form.getAll(DIAGNOSTIC_REPORT_FIELD)
  const files = form.getAll(DIAGNOSTIC_FILE_FIELD)
  if ([...form.keys()].some(key => ![DIAGNOSTIC_REPORT_FIELD, DIAGNOSTIC_FILE_FIELD].includes(key)) || reports.length !== 1 || files.length !== 1) throw ErrorParam()
  const file = files[0]
  if (typeof reports[0] !== 'string' || typeof file === 'string' || !file || !file.size || file.size > DIAGNOSTIC_ATTACHMENT_MAX_BYTES) throw ErrorParam()
  if (bytes.length - file.size > DIAGNOSTIC_MULTIPART_OVERHEAD_MAX_BYTES) throw ErrorParam()
  let report
  try {
    report = parseReportJson(reports[0])
  } catch {
    throw ErrorParam()
  }
  return { report: parseReport(report, true), diagnostic: sanitizeDiagnosticFile(new Uint8Array(await file.arrayBuffer())) }
}
