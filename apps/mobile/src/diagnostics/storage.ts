import {DIAGNOSTIC_QUOTA_BYTES, DIAGNOSTIC_RETENTION_DAYS, diagnosticDay, parseDiagnosticFilename, parseDiagnosticLine, type DiagnosticFile, type DiagnosticRecord} from '../domain/diagnostics.ts';
import type {DiagnosticWriter} from './transport.ts';
import {sanitizeDiagnosticRecord} from './export-sanitize.ts';

export const DIAGNOSTIC_UPLOAD_MAX_BYTES = 12582912;
export const DIAGNOSTIC_MULTIPART_OVERHEAD_BYTES = 65536;
export interface DiagnosticExport {uri: string; filename: string; file: Blob; release(): void}
export class DiagnosticExportError extends Error {
  readonly code: 'empty' | 'unavailable' | 'too-large' | 'sharing-unavailable';
  constructor(code: DiagnosticExportError['code']) {super(code); this.name = 'DiagnosticExportError'; this.code = code;}
}
export interface DiagnosticStorage extends DiagnosticWriter {
  shareAvailable: boolean;
  list(): Promise<{name: string; size: number}[]>;
  read(name: string): Promise<string>;
  remove(name: string): Promise<void>;
  stage?(lines: string, now: Date): Promise<DiagnosticExport>;
  share?(file: DiagnosticExport, assertCurrent?: () => void): Promise<void>;
  export(lines: string, now: Date, assertCurrent?: () => void): Promise<void>;
}
export interface DiagnosticDay {day: string; size: number; files: DiagnosticFile[]}
export async function listDiagnosticDays(storage: DiagnosticStorage): Promise<DiagnosticDay[]> {
  const days = new Map<string, DiagnosticDay>();
  for (const file of await storage.list()) {
    const parsed = parseDiagnosticFilename(file.name);
    if (!parsed) continue;
    const day = days.get(parsed.day) ?? {day: parsed.day, size: 0, files: []};
    day.files.push({...file, ...parsed}); day.size += file.size; days.set(day.day, day);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}
export async function readDiagnosticDay(storage: DiagnosticStorage, day: DiagnosticDay): Promise<DiagnosticRecord[]> {
  const records: DiagnosticRecord[] = [];
  for (const file of day.files) {
    let text: string;
    try {text = await storage.read(file.name);} catch {continue;}
    for (const line of text.split('\n')) {const record = parseDiagnosticLine(line); if (record) records.push(record);}
  }
  return records.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}
export async function pruneDiagnostics(storage: DiagnosticStorage, now: Date) {
  try {
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - DIAGNOSTIC_RETENTION_DAYS);
    const files = (await storage.list()).filter(file => parseDiagnosticFilename(file.name)).sort((a, b) => a.name.localeCompare(b.name));
    let size = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (file.name.slice(0, 10) < diagnosticDay(cutoff) || size > DIAGNOSTIC_QUOTA_BYTES) {
        try {await storage.remove(file.name); size -= file.size;} catch {}
      }
    }
  } catch {}
}
export async function clearDiagnostics(storage: DiagnosticStorage, assertCurrent = () => {}) {
  for (const file of await storage.list()) if (file.name.endsWith('.ndjson')) {assertCurrent(); await storage.remove(file.name);}
}
export async function buildDiagnosticExport(storage: DiagnosticStorage, days: DiagnosticDay[], assertCurrent = () => {}) {
  const records: Record<string, unknown>[] = [];
  for (const day of days) for (const file of day.files) {
    assertCurrent();
    const text = await storage.read(file.name);
    assertCurrent();
    for (const line of text.split('\n')) {
      const parsed = parseDiagnosticLine(line), record = parsed && sanitizeDiagnosticRecord(parsed);
      if (record) records.push(record);
    }
  }
  if (!records.length) throw new DiagnosticExportError('empty');
  records.sort((a, b) => Date.parse(a.ts as string) - Date.parse(b.ts as string));
  return records.map(record => JSON.stringify(record)).join('\n') + '\n';
}
export async function exportDiagnostics(storage: DiagnosticStorage, days: DiagnosticDay[], now: Date, assertCurrent = () => {}) {
  const lines = await buildDiagnosticExport(storage, days, assertCurrent);
  assertCurrent(); await storage.export(lines, now, assertCurrent);
}
export interface RecentDiagnosticSource {storage: DiagnosticStorage | null; flush?(): Promise<void>; now?: () => Date}
export async function stageRecentDiagnostics(source: RecentDiagnosticSource, assertCurrent = () => {}): Promise<DiagnosticExport> {
  const storage = source.storage;
  if (!storage?.stage) throw new DiagnosticExportError('unavailable');
  assertCurrent(); await source.flush?.(); assertCurrent();
  const now = source.now?.() ?? new Date();
  const days = await listDiagnosticDays(storage), selected = defaultExportDays(days, now);
  const lines = await buildDiagnosticExport(storage, days.filter(day => selected.includes(day.day)), assertCurrent);
  if (new TextEncoder().encode(lines).byteLength > DIAGNOSTIC_UPLOAD_MAX_BYTES) throw new DiagnosticExportError('too-large');
  assertCurrent();
  const file = await storage.stage(lines, now);
  try {assertCurrent(); if (file.file.size > DIAGNOSTIC_UPLOAD_MAX_BYTES) throw new DiagnosticExportError('too-large'); return file;}
  catch (error) {file.release(); throw error;}
}
export async function shareRecentDiagnostics(source: RecentDiagnosticSource, assertCurrent = () => {}) {
  if (!source.storage?.share) throw new DiagnosticExportError('sharing-unavailable');
  const file = await stageRecentDiagnostics(source, assertCurrent);
  try {assertCurrent(); await source.storage.share(file, assertCurrent);} finally {file.release();}
}
export function defaultExportDays(days: DiagnosticDay[], now: Date) {
  const start = new Date(now); start.setDate(start.getDate() - 6);
  const first = diagnosticDay(start), last = diagnosticDay(now);
  return days.filter(day => day.day >= first && day.day <= last).map(day => day.day);
}
