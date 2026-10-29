import type {DiagnosticHeaders, DiagnosticToken} from './diagnostics.ts';

export const requestHeaderAllowlist = ['User-Agent', 'Content-Type', 'Accept', 'X-CLIENT-TYPE', 'X-CLIENT-VERSION', 'Authorization'] as const;
export const responseHeaderAllowlist = ['Date', 'Content-Type', 'CF-Ray', 'Retry-After', 'Server', 'CF-Cache-Status'] as const;
export function redactAuthorization(value: unknown): DiagnosticToken {
  const token = typeof value === 'string' ? value.replace(/^Bearer\s+/i, '') : '';
  return {present: token.length > 0, len: token.length, ...(token.length > 4 ? {tail4: token.slice(-4)} : {})};
}
export function redactHeaders(value: Headers | Record<string, string> | undefined, direction: 'request' | 'response'): DiagnosticHeaders {
  const result: DiagnosticHeaders = {};
  try {
    for (const name of direction === 'request' ? requestHeaderAllowlist : responseHeaderAllowlist) {
      const raw = value && typeof (value as Headers).get === 'function' ? (value as Headers).get(name) : Object.entries(value ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
      if (name === 'Authorization') result[name] = redactAuthorization(raw);
      else if (typeof raw === 'string') result[name] = raw.slice(0, 256);
    }
  } catch {}
  return result;
}
