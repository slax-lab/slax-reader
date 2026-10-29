import type {DiagnosticRecord, DiagnosticSource} from '../domain/diagnostics.ts';
import {clearDiagnostics, defaultExportDays, exportDiagnostics, listDiagnosticDays, readDiagnosticDay, type DiagnosticDay, type DiagnosticStorage} from './storage.ts';
import type {DiagnosticSnapshot} from './snapshot.ts';

export interface DiagnosticLogState {days: DiagnosticDay[]; day: string | null; records: DiagnosticRecord[]; source: DiagnosticSource | 'all'; detail: DiagnosticRecord | null; snapshot: DiagnosticSnapshot | null; selectedDays: string[]; busy: boolean; error: boolean; shareAvailable: boolean}
export function createDiagnosticLogController(options: {storage: DiagnosticStorage | null; snapshot(): Promise<DiagnosticSnapshot>; flush?(): Promise<void>; now?: () => Date}) {
  let state: DiagnosticLogState = {days: [], day: null, records: [], source: 'all', detail: null, snapshot: null, selectedDays: [], busy: false, error: false, shareAvailable: options.storage?.shareAvailable ?? false};
  let generation = 0, operation = 0, alive = false, action = false;
  const listeners = new Set<() => void>(), now = options.now ?? (() => new Date());
  const update = (patch: Partial<DiagnosticLogState>) => {state = {...state, ...patch}; listeners.forEach(listener => listener());};
  const current = (owner: number, request: number) => alive && generation === owner && operation === request;
  const run = async (work: (assertCurrent: () => void) => Promise<Partial<DiagnosticLogState>>) => {
    if (!alive || action) return;
    const owner = generation, request = ++operation; action = true; update({busy: true, error: false});
    const assertCurrent = () => {if (!current(owner, request)) throw new Error('Diagnostic viewer closed');};
    try {const patch = await work(assertCurrent); if (current(owner, request)) update(patch);}
    catch {if (current(owner, request)) update({error: true});}
    finally {if (current(owner, request)) {action = false; update({busy: false});}}
  };
  const controller = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    async open() {
      alive = true; generation++; operation++; action = false;
      await run(async assertCurrent => {
        await options.flush?.(); assertCurrent();
        const [snapshot, days] = await Promise.all([options.snapshot(), options.storage ? listDiagnosticDays(options.storage) : Promise.resolve([])]);
        return {snapshot, days, day: null, records: [], detail: null, source: 'all', selectedDays: defaultExportDays(days, now())};
      });
    },
    close() {alive = false; generation++; operation++; action = false;},
    async openDay(day: string) {
      await run(async () => {const value = state.days.find(item => item.day === day); return value && options.storage ? {day, records: await readDiagnosticDay(options.storage, value), detail: null} : {};});
    },
    back() {if (state.busy) return; if (state.detail) update({detail: null}); else update({day: null, records: []});},
    selectRecord(record: DiagnosticRecord) {update({detail: record});},
    filter(source: DiagnosticSource | 'all') {update({source});},
    toggleDay(day: string) {if (!state.busy) update({selectedDays: state.selectedDays.includes(day) ? state.selectedDays.filter(item => item !== day) : [...state.selectedDays, day]});},
    async exportSelected() {await run(async assertCurrent => {
      if (!options.storage) throw new Error('Diagnostic storage unavailable');
      const selected = [...state.selectedDays], snapshot = await options.snapshot(); assertCurrent();
      await options.flush?.(); assertCurrent();
      const days = await listDiagnosticDays(options.storage); assertCurrent();
      await exportDiagnostics(options.storage, snapshot, days.filter(day => selected.includes(day.day)), now(), assertCurrent);
      return {snapshot};
    });},
    async clear() {await run(async assertCurrent => {
      if (!options.storage) throw new Error('Diagnostic storage unavailable');
      await options.flush?.(); assertCurrent(); await clearDiagnostics(options.storage, assertCurrent);
      return {days: await listDiagnosticDays(options.storage), records: [], day: null, detail: null, selectedDays: []};
    });},
  };
  return controller;
}
export type DiagnosticLogController = ReturnType<typeof createDiagnosticLogController>;
