import {AppState, Platform} from 'react-native';
import {Directory, File, Paths} from 'expo-file-system';
import {exportDiagnosticFile, shareDiagnosticFile, stageDiagnosticFile} from './native-export.ts';
import {logger} from 'react-native-logs';
import {diagnosticTimestamp, noDiagnostics, type DiagnosticSink} from '../domain/diagnostics.ts';
import {createDiagnosticTransport, diagnosticClock, type DiagnosticClock} from './transport.ts';
import {pruneDiagnostics, type DiagnosticStorage} from './storage.ts';
import {firstInteractive} from '../observe/interactive.ts';

export const DIAGNOSTIC_RETENTION_DELAY_MS = 10000;

export function resolveDiagnosticLocation(platform: string, paths: {document: string | Directory; appleSharedContainers?: Record<string, Directory>}) {
  if (platform === 'ios') {
    try {const shared = paths.appleSharedContainers?.['group.app.slax.reader']; if (shared) return {base: shared, shareAvailable: true};} catch {}
    return {base: paths.document, shareAvailable: false};
  }
  return {base: paths.document, shareAvailable: platform === 'android'};
}
export function createDiagnosticStorage(removed: (name: string) => void = () => {}): DiagnosticStorage {
  const location = resolveDiagnosticLocation(Platform.OS, Paths), directory = () => new Directory(location.base, 'diagnostics'), handles = new Map<string, File>();
  let ready = false;
  const file = (name: string) => {if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('Invalid diagnostic file'); return new File(directory(), name);};
  return {shareAvailable: location.shareAvailable,
    async list() {const dir = directory(); return dir.exists ? dir.list().filter((entry): entry is File => entry instanceof File).map(entry => ({name: entry.name, size: entry.size})) : [];},
    size(name) {const target = file(name); return target.exists ? target.size : 0;},
    async append(name, lines) {
      try {
        if (!ready) {const dir = directory(); if (!dir.exists) dir.create({intermediates: true, idempotent: true}); ready = true;}
        let target = handles.get(name); if (!target) {target = file(name); handles.clear(); handles.set(name, target);}
        await target.write(lines, {append: true});
      } catch (error) {ready = false; handles.delete(name); throw error;}
    },
    read: name => file(name).text(),
    async remove(name) {try {const target = file(name); if (target.exists) target.delete();} finally {handles.delete(name); removed(name);}},
    stage: stageDiagnosticFile, share: shareDiagnosticFile, export: exportDiagnosticFile,
  };
}
export interface MobileDiagnostics {sink: DiagnosticSink; storage: DiagnosticStorage | null; start(): () => void; flush(): Promise<void>}
export function createMobileDiagnostics(app: string, clock: DiagnosticClock = diagnosticClock, interactive: {subscribe(listener: () => void): () => void} = firstInteractive): MobileDiagnostics {
  try {
    let forget = () => {};
    const storage = createDiagnosticStorage(() => forget()), common = {launch: `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`};
    const metadata = {app, os: Platform.OS === 'android' ? `Android ${Platform.constants.Release}` : `iOS ${Platform.Version}`};
    const idleClock: DiagnosticClock = {...clock, idle: callback => typeof globalThis.requestIdleCallback === 'function' ? globalThis.requestIdleCallback(callback) : clock.schedule(callback, 0), cancelIdle: handle => typeof globalThis.cancelIdleCallback === 'function' ? globalThis.cancelIdleCallback(handle as number) : clock.cancel(handle)};
    const transport = createDiagnosticTransport(storage, common, idleClock);
    forget = transport.forget;
    const log = logger.createLogger({async: true, asyncFunc: transport.schedule, transport: transport.transport, formatFunc: () => '', printDate: false, printLevel: false});
    let launched = false;
    const sink: DiagnosticSink = {record(event, fields) {try {
      if (event === 'app.launch') {if (launched) return; launched = true;}
      log.info({...fields, ...common, ...(event === 'app.launch' ? metadata : {}), v: 1, ts: diagnosticTimestamp(clock.now()), src: 'app', event});
    } catch {}}};
    let retained = false;
    return {sink, storage, flush: transport.flush, start() {
      let subscription: {remove(): void} | undefined, retention: unknown, stopInteractive: (() => void) | undefined, stopped = false;
      try {subscription = AppState.addEventListener('change', state => {if (state === 'background') transport.background();});} catch {}
      try {if (!retained) stopInteractive = interactive.subscribe(() => {
        if (stopped || retained || retention !== undefined) return;
        try {retention = clock.schedule(() => {retention = undefined; if (stopped) return; retained = true; void pruneDiagnostics(storage, clock.now()).catch(() => {});}, DIAGNOSTIC_RETENTION_DELAY_MS);} catch {}
      });} catch {}
      return () => {
        stopped = true;
        try {subscription?.remove(); stopInteractive?.(); if (retention !== undefined) clock.cancel(retention); retention = undefined;} catch {}
        void transport.flush().finally(transport.dispose);
      };
    }};
  } catch {return {sink: noDiagnostics, storage: null, start: () => () => {}, flush: () => Promise.resolve()};}
}
