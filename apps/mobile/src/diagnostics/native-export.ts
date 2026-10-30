import {Directory, File, Paths} from 'expo-file-system';
import {isAvailableAsync, shareAsync} from 'expo-sharing';
import {diagnosticDay} from '../domain/diagnostics.ts';
import {DiagnosticExportError, type DiagnosticExport} from './storage.ts';

const active = new Set<string>();
let sequence = 0;
const directory = () => new Directory(Paths.cache, 'diagnostics-export');
export function pruneDiagnosticExports(now = Date.now()) {
  try {
    const dir = directory();
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      if (entry instanceof File && /^slax-diagnostics-.*\.ndjson$/.test(entry.name) && !active.has(entry.uri) && entry.modificationTime !== null && entry.modificationTime < now - 10 * 60 * 1000) {try {entry.delete();} catch {}}
    }
  } catch {}
}
export async function stageDiagnosticFile(lines: string, now: Date): Promise<DiagnosticExport> {
  pruneDiagnosticExports(now.getTime());
  const dir = directory();
  if (!dir.exists) dir.create({intermediates: true, idempotent: true});
  const filename = `slax-diagnostics-${diagnosticDay(now)}-${now.getTime()}-${++sequence}.ndjson`, file = new File(dir, filename);
  active.add(file.uri);
  try {await file.write(lines);} catch (error) {active.delete(file.uri); try {if (file.exists) file.delete();} catch {} throw error;}
  return {uri: file.uri, filename, file, release() {active.delete(file.uri); pruneDiagnosticExports();}};
}
export async function shareDiagnosticFile(file: DiagnosticExport, assertCurrent = () => {}) {
  const available = await isAvailableAsync();
  assertCurrent();
  if (!available) throw new DiagnosticExportError('sharing-unavailable');
  await shareAsync(file.uri, {mimeType: 'application/x-ndjson', UTI: 'public.json'});
}
export async function exportDiagnosticFile(lines: string, now: Date, assertCurrent = () => {}) {
  const file = await stageDiagnosticFile(lines, now);
  try {assertCurrent(); await shareDiagnosticFile(file, assertCurrent);} finally {file.release();}
}
