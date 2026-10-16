export type PdfFailureStage = 'native' | 'worker' | 'range' | 'document' | 'render' | 'command' | 'pdf-metadata' | 'pdf-range' | 'pdf-upload' | 'api'
export interface PdfFailure {code: string; stage: PdfFailureStage; status?: number}
const stages = new Set<PdfFailureStage>(['native', 'worker', 'range', 'document', 'render', 'command', 'pdf-metadata', 'pdf-range', 'pdf-upload', 'api'])
const codes = new Set(['PdfRenderError', 'PasswordException', 'InvalidPDFException', 'MissingPDFException', 'UnknownErrorException',
  'ReaderProcessGone', 'PDF_WORKER_UNAVAILABLE', 'PDF_WORKER_FAILED', 'PDF_RANGE_INVALID', 'PDF_RANGE_TIMEOUT', 'PDF_RANGE_FAILED',
  'PDF_DOCUMENT_INVALID', 'PDF_COMMAND_FAILED', 'NETWORK', 'TIMEOUT', 'CANCELLED', 'HTTP', 'AUTHORIZATION', 'IDENTITY', 'INTEGRITY', 'STORAGE',
  'network', 'timeout', 'cancelled', 'http', 'authorization', 'identity', 'integrity', 'storage',
  'network_unavailable', 'request_timeout', 'http_unauthorized', 'http_forbidden', 'http_not_found', 'http_precondition_failed', 'http_range_not_satisfiable',
  'http_rate_limited', 'http_server_error', 'http_error', 'pdf_metadata_invalid', 'pdf_identity_mismatch', 'pdf_range_invalid', 'pdf_length_invalid',
  'pdf_stream_unavailable', 'pdf_body_invalid', 'pdf_upload_invalid', 'operation_cancelled', 'session_changed'])
export function pdfFailure(value: unknown, stage: PdfFailureStage): PdfFailure {
  const error = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  const candidate = typeof error.code === 'string' ? error.code : error.name
  const code = typeof candidate === 'string' && codes.has(candidate) ? candidate : 'PdfRenderError'
  return {code, stage: typeof error.stage === 'string' && stages.has(error.stage as PdfFailureStage) ? error.stage as PdfFailureStage : stage,
    ...(typeof error.status === 'number' && Number.isSafeInteger(error.status) && error.status >= 100 && error.status <= 599 ? {status: error.status} : {})}
}
export function pdfFailureError(value: unknown, stage: PdfFailureStage): Error & PdfFailure {
  const failure = pdfFailure(value, stage)
  const error = Object.assign(new Error(`PDF ${failure.stage} failed (${failure.code})`), failure)
  if (failure.code === 'PasswordException' || failure.code === 'ReaderProcessGone') error.name = failure.code
  return error
}
