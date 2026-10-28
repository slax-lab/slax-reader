import {getDataErrorDiagnostic} from '../../data/transport-errors'
import {rssErrorCode} from '../../rss/controller'
import {offlineEngineError} from '../../data/offline-engine'
import {pdfFailure} from '../pdf-errors'

/** A byte-range failure reported by the PDF page carries the native engine code; map it like any other engine read. */
export const pdfRangeError = (error: Error): unknown => {
  const failure = pdfFailure(error, 'document')
  if (failure.stage !== 'pdf-range') return error
  return offlineEngineError({code: failure.code, message: failure.status ? `${failure.code} (${failure.status})` : failure.code}, 'pdf-range')
}

export const pdfMustInvalidate = (error: unknown) => {
  const diagnostic = getDataErrorDiagnostic(error)
  return diagnostic.kind === 'protocol' || diagnostic.kind === 'http' && [401, 403, 404, 412].includes(diagnostic.status ?? 0)
}
export const pdfFailureMessage = (error: unknown, t: (key: string) => string, stage = 'renderer') => {
  const diagnostic = getDataErrorDiagnostic(error), renderer = pdfFailure(error, 'document')
  const label = diagnostic.kind === 'network' ? 'pdf_offline_missing' : renderer.code === 'PasswordException' ? 'pdf_password' : 'pdf_load_failed'
  const detail = diagnostic.stage !== 'unknown' ? `${diagnostic.stage}/${diagnostic.code}` : stage === 'renderer' ? `${renderer.stage}/${renderer.code}` : `${stage}/${diagnostic.code}`
  return `${t(label)} (${detail})`
}
const rssReaderErrorCodes = new Set(['lab_disabled', 'not_found', 'source_unavailable', 'article_url_missing'])
export const rssReaderErrorCode = (error: unknown) => {
  const code = rssErrorCode(error)
  return rssReaderErrorCodes.has(code) ? code : 'source_unavailable'
}
