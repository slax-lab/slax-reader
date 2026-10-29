export const DIAGNOSTIC_LINE_BYTES = 4096;
export const DIAGNOSTIC_DAILY_BYTES = 524288;
export const DIAGNOSTIC_RETENTION_DAYS = 30;
export const DIAGNOSTIC_QUOTA_BYTES = 20971520;
export const DIAGNOSTIC_QUEUE_LIMIT = 200;
export const DIAGNOSTIC_FLUSH_MS = 2000;
export const diagnosticSources = ['app', 'share-ios', 'share-android'] as const;
export type DiagnosticSource = typeof diagnosticSources[number];
export type SignOutCause = 'user' | 'unauthorized' | 'account_deleted' | 'environment_switch' | 'other';
export interface DiagnosticHttp {method: string; path: string; status: number | null; code: number | null; cfRay: string | null}
export interface DiagnosticError {class: string; domain?: string; code?: string | number; status?: number}
export interface DiagnosticToken {present: boolean; len: number; tail4?: string}
export type DiagnosticHeaders = Record<string, string | DiagnosticToken>;
export interface DiagnosticExchange {http: DiagnosticHttp; headers: {request: DiagnosticHeaders; response: DiagnosticHeaders}; durationMs: number; provider?: 'google' | 'apple'; error?: unknown; canDelete?: boolean; reason?: string | null}
export interface DiagnosticEvents {
  'app.launch': Record<string, never>;
  'auth.login': {provider: 'google' | 'apple'; ok: boolean; http: DiagnosticHttp | null; durationMs: number; headers: {request: DiagnosticHeaders; response: DiagnosticHeaders}};
  'auth.signout': {cause: SignOutCause};
  'auth.reauth_required': {http?: DiagnosticHttp};
  'auth.refresh_failed': {http: DiagnosticHttp; error: DiagnosticError | null};
  'account.delete': {ok: boolean; canDelete: boolean | null; reason: string | null; http: DiagnosticHttp | null};
  'log.dropped': {count: number};
  'log.truncated': Record<string, never>;
}
export interface DiagnosticSink {record<E extends keyof DiagnosticEvents>(event: E, fields: DiagnosticEvents[E]): void}
export const noDiagnostics: DiagnosticSink = {record() {}};
export function snapshotDiagnostic<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => snapshotDiagnostic(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotDiagnostic(item)])) as T;
  return value;
}
export function recordDiagnostic<E extends keyof DiagnosticEvents>(sink: DiagnosticSink | undefined, event: E, fields: DiagnosticEvents[E]) {
  try {sink?.record(event, snapshotDiagnostic(fields));} catch {}
}
export interface DiagnosticCommon {v: 1; ts: string; src: DiagnosticSource; launch: string; app: string; os: string}
export type AppDiagnosticRecord = {[E in keyof DiagnosticEvents]: DiagnosticCommon & {event: E} & DiagnosticEvents[E]}[keyof DiagnosticEvents];
export type DiagnosticRecord = DiagnosticCommon & {event: keyof DiagnosticEvents | 'share.start' | 'share.end'; [key: string]: unknown};
export interface DiagnosticFile {name: string; size: number; day: string; src: DiagnosticSource}
const pad = (value: number, width = 2) => String(value).padStart(width, '0');
export function diagnosticDay(date: Date) {return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;}
export function diagnosticTimestamp(date: Date) {
  const offset = -date.getTimezoneOffset();
  return `${diagnosticDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
export function diagnosticFilename(day: string, src: DiagnosticSource) {return `${day}.${src}.ndjson`;}
export function parseDiagnosticFilename(name: string): Pick<DiagnosticFile, 'day' | 'src'> | null {
  const match = /^(\d{4}-\d{2}-\d{2})\.(app|share-ios|share-android)\.ndjson$/.exec(name);
  if (!match) return null;
  const [year, month, day] = match[1]!.split('-').map(Number), date = new Date(year!, month! - 1, day!);
  return diagnosticDay(date) === match[1] ? {day: match[1]!, src: match[2] as DiagnosticSource} : null;
}
export function parseDiagnosticLine(line: string): DiagnosticRecord | null {
  try {
    if (new TextEncoder().encode(line + '\n').length > DIAGNOSTIC_LINE_BYTES) return null;
    const value = JSON.parse(line);
    return value && value.v === 1 && diagnosticSources.includes(value.src) && typeof value.event === 'string' && typeof value.ts === 'string' && Number.isFinite(Date.parse(value.ts)) ? value as DiagnosticRecord : null;
  } catch {return null;}
}
