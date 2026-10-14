export const PDF_REQUEST_TIMEOUT_MS = 120000;
export const PDF_REQUEST_MAX_ATTEMPTS = 3;
export const PDF_RETRY_DELAYS_MS = [1000, 2000] as const;
export type DataErrorStage = 'api' | 'pdf-metadata' | 'pdf-range' | 'pdf-upload';
export type DataErrorKind = 'network' | 'timeout' | 'http' | 'protocol' | 'cancelled' | 'session' | 'unknown';
export type DataErrorCode = 'network_unavailable' | 'request_timeout' | 'http_unauthorized' | 'http_forbidden' | 'http_not_found' | 'http_precondition_failed' | 'http_range_not_satisfiable' | 'http_rate_limited' | 'http_server_error' | 'http_error' | 'pdf_metadata_invalid' | 'pdf_identity_mismatch' | 'pdf_range_invalid' | 'pdf_length_invalid' | 'pdf_stream_unavailable' | 'pdf_body_invalid' | 'pdf_upload_invalid' | 'operation_cancelled' | 'session_changed' | 'unknown';
export interface DataErrorDiagnostic {stage: DataErrorStage | 'unknown'; kind: DataErrorKind; code: DataErrorCode; status?: number}

export class DataTransportError extends Error {
  readonly kind: 'network' | 'timeout';
  readonly stage: DataErrorStage;
  readonly code: 'network_unavailable' | 'request_timeout';
  constructor(kind: 'network' | 'timeout', stage: DataErrorStage) {
    super(kind === 'timeout' ? 'PDF request timed out' : 'Network request failed');
    this.name = 'DataTransportError'; this.kind = kind; this.stage = stage;
    this.code = kind === 'timeout' ? 'request_timeout' : 'network_unavailable';
  }
}
export const isNetworkTransportError = (error: unknown): error is DataTransportError => error instanceof DataTransportError && error.kind === 'network';
export const httpErrorCode = (status: number): DataErrorCode => {
  switch (status) {
    case 401: return 'http_unauthorized';
    case 403: return 'http_forbidden';
    case 404: return 'http_not_found';
    case 412: return 'http_precondition_failed';
    case 416: return 'http_range_not_satisfiable';
    case 429: return 'http_rate_limited';
    default: return status >= 500 && status <= 599 ? 'http_server_error' : 'http_error';
  }
};
export function getDataErrorDiagnostic(error: unknown): DataErrorDiagnostic {
  if (error instanceof DataTransportError) return {stage: error.stage, kind: error.kind, code: error.code};
  if (error instanceof Error && error.name === 'AbortError') return {stage: 'unknown', kind: 'cancelled', code: 'operation_cancelled'};
  if (error instanceof Error && error.name === 'SessionChangedError') return {stage: 'unknown', kind: 'session', code: 'session_changed'};
  if (error instanceof Error && error.name === 'ApiError' && 'status' in error && typeof error.status === 'number') {
    const stage = 'stage' in error && ['api', 'pdf-metadata', 'pdf-range', 'pdf-upload'].includes(String(error.stage)) ? error.stage as DataErrorStage : 'api';
    const kind = 'kind' in error && error.kind === 'protocol' ? 'protocol' : 'http';
    const protocolCodes = ['pdf_metadata_invalid', 'pdf_identity_mismatch', 'pdf_range_invalid', 'pdf_length_invalid', 'pdf_stream_unavailable', 'pdf_body_invalid', 'pdf_upload_invalid'];
    const code = kind === 'protocol' && 'code' in error && protocolCodes.includes(String(error.code)) ? error.code as DataErrorCode : httpErrorCode(error.status);
    return {stage, kind, code, status: Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined};
  }
  return {stage: 'unknown', kind: 'unknown', code: 'unknown'};
}
