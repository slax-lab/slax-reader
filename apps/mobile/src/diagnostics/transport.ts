import {DIAGNOSTIC_DAILY_BYTES, DIAGNOSTIC_FLUSH_MS, DIAGNOSTIC_LINE_BYTES, DIAGNOSTIC_QUEUE_LIMIT, diagnosticDay, diagnosticFilename, diagnosticTimestamp, type DiagnosticCommon, type DiagnosticRecord} from '../domain/diagnostics.ts';

export interface DiagnosticClock {now(): Date; schedule(callback: () => void, ms: number): unknown; cancel(handle: unknown): void; idle?(callback: () => void): unknown; cancelIdle?(handle: unknown): void}
export interface DiagnosticWriter {size(name: string): number | Promise<number>; append(name: string, lines: string): Promise<void>}
export const diagnosticClock: DiagnosticClock = {now: () => new Date(), schedule: (callback, ms) => setTimeout(callback, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)};
type Entry = {day: string; line: string; bytes: number};
export function createDiagnosticTransport(writer: DiagnosticWriter, common: Omit<DiagnosticCommon, 'v' | 'ts' | 'src'>, clock = diagnosticClock) {
  const queue: Entry[] = [], scheduled: (() => void)[] = [], sizes = new Map<string, number>();
  let timer: unknown, idle: unknown, flight: Promise<void> | undefined, drainRequested = false, disabled = false, disposed = false, failures = 0, dropped = 0, sizing = 0;
  const encode = (record: DiagnosticRecord): Entry | null => {
    const line = JSON.stringify(record) + '\n', bytes = new TextEncoder().encode(line).length;
    return bytes <= DIAGNOSTIC_LINE_BYTES ? {day: record.ts.slice(0, 10), line, bytes} : null;
  };
  const marker = (event: 'log.dropped' | 'log.truncated', fields: Record<string, number> = {}) => encode({...common, v: 1, ts: diagnosticTimestamp(clock.now()), src: 'app', event, ...fields})!;
  const stopTimer = () => {try {if (timer !== undefined) clock.cancel(timer);} catch {} timer = undefined;};
  const stopIdle = () => {try {if (idle !== undefined) (clock.cancelIdle ?? clock.cancel)(idle);} catch {} idle = undefined;};
  const makeRoom = () => {if (queue.length + scheduled.length >= DIAGNOSTIC_QUEUE_LIMIT) {if (queue.length) queue.shift(); else scheduled.shift(); dropped++;}};
  const drainScheduled = () => {stopIdle(); while (scheduled.length && !disabled && !disposed) {try {scheduled.shift()!();} catch {}}};
  const arm = () => {
    if (timer !== undefined || flight || disabled || disposed || !queue.length && !scheduled.length) return;
    try {timer = clock.schedule(() => {timer = undefined; void flush();}, DIAGNOSTIC_FLUSH_MS);} catch {}
  };
  const receive = (props: {rawMsg: unknown}) => {
    try {
      if (disabled || disposed || !Array.isArray(props.rawMsg)) return;
      for (const record of props.rawMsg) {
        const entry = encode(record as DiagnosticRecord);
        if (entry) {makeRoom(); queue.push(entry);}
      }
      arm();
    } catch {}
  };
  const schedule = (work: () => void) => {
    try {
      if (disabled || disposed) return;
      makeRoom(); scheduled.push(work); arm();
      if (idle === undefined) idle = (clock.idle ?? (callback => clock.schedule(callback, 0)))(() => {idle = undefined; drainScheduled();});
    } catch {}
  };
  async function writeBatch(entries: Entry[]) {
    const overflow = dropped, overflowEntry = overflow ? marker('log.dropped', {count: overflow}) : null;
    if (overflowEntry) entries.unshift(overflowEntry);
    const groups = new Map<string, Entry[]>();
    for (const entry of entries) {const group = groups.get(entry.day) ?? []; group.push(entry); groups.set(entry.day, group);}
    for (const [day, group] of groups) {
      try {
        const name = diagnosticFilename(day, 'app');
        const generation = sizing;
        let size = sizes.get(name), lines = '', includesOverflow = false;
        if (size === undefined) {size = await writer.size(name); if (generation === sizing) {sizes.clear(); sizes.set(name, size);}}
        for (const entry of group) {
          if (size >= DIAGNOSTIC_DAILY_BYTES) break;
          lines += entry.line; size += entry.bytes;
          includesOverflow ||= entry === overflowEntry;
          if (size >= DIAGNOSTIC_DAILY_BYTES) {const truncated = marker('log.truncated'); lines += truncated.line; size += truncated.bytes;}
        }
        if (!lines) continue;
        try {await writer.append(name, lines);} catch (error) {sizes.delete(name); throw error;}
        if (generation === sizing) sizes.set(name, size); failures = 0;
        if (includesOverflow) dropped = Math.max(0, dropped - overflow);
      } catch {
        if (++failures >= 3) {disabled = true; queue.length = 0; scheduled.length = 0; stopTimer(); stopIdle(); break;}
      }
    }
  }
  function flush(): Promise<void> {
    try {
      if (disabled || disposed) return Promise.resolve();
      if (flight) {drainRequested = true; return flight;}
      stopTimer(); drainScheduled(); stopTimer();
      if (!queue.length) return Promise.resolve();
      let entries = queue.splice(0);
      flight = Promise.resolve().then(async () => {
        do {
          drainRequested = false; await writeBatch(entries);
          if (!drainRequested || disabled || disposed) break;
          drainScheduled(); stopTimer(); entries = queue.splice(0);
        } while (entries.length);
      }).catch(() => {}).finally(() => {flight = undefined; arm();});
      return flight;
    } catch {return Promise.resolve();}
  }
  return {transport: receive, schedule, flush, background() {try {void flush();} catch {}}, forget() {sizing++; sizes.clear();},
    dispose() {disposed = true; stopTimer(); stopIdle(); queue.length = 0; scheduled.length = 0; sizes.clear();},
    getState: () => ({pending: queue.length + scheduled.length, dropped, failures, disabled}),
    timestamp: () => diagnosticTimestamp(clock.now()), day: () => diagnosticDay(clock.now()),
  };
}
