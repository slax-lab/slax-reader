import {bookmarkCacheKey} from './repositories/records.ts';
import type {CacheCandidate, CacheLocalState, CacheTask} from './repositories/cache-state.ts';

function sameTask(left: CacheTask, right: CacheTask) {
  return left.id === right.id && left.key === right.key && left.owner === right.owner && left.domain === right.domain && left.pdf === right.pdf;
}

export class AutomaticCachePlan {
  readonly window = new Set<string>();
  readonly tasks = new Map<string, CacheTask>();
  private groups = new Map<string, CacheCandidate[]>();
  private memberships = new Map<string, string>();
  private windows = new Map<string, Set<string>>();
  private selected = new Map<string, CacheTask>();
  private locals = new Map<string, CacheLocalState>();
  private dirtyGroups = new Set<string>();
  private dirtyKeys = new Set<string>();
  private limit = 50;
  private readonly pdfAvailable: boolean;

  constructor(pdfAvailable: boolean) {this.pdfAvailable = pdfAvailable;}

  setLimit(limit: number) {
    if (Object.is(this.limit, limit)) return;
    this.limit = limit;
    for (const group of this.groups.keys()) this.dirtyGroups.add(group);
  }

  setCandidates(domain: CacheTask['domain'], rows: CacheCandidate[]) {
    const prefix = `${domain}:`, next = new Map<string, CacheCandidate[]>();
    for (const row of rows) {
      if (domain === 'collection' && !row.owner?.trim()) continue;
      const key = `${prefix}${row.owner ?? ''}`, group = next.get(key);
      if (group) group.push(row); else next.set(key, [row]);
    }
    for (const [key, previous] of this.groups) {
      if (!key.startsWith(prefix)) continue;
      const rows = next.get(key);
      if (rows && previous.length === rows.length && previous.every((row, index) => row === rows[index])) {next.delete(key); continue;}
      for (const row of previous) {this.memberships.delete(row.key); this.dirtyKeys.add(row.key);}
      this.groups.delete(key); this.dirtyGroups.add(key);
    }
    for (const [key, rows] of next) {
      this.groups.set(key, rows); this.dirtyGroups.add(key);
      for (const row of rows) this.memberships.set(row.key, key);
    }
  }

  setLocal(rows: CacheLocalState[]) {
    const next = new Map(rows.map(row => [row.id, row]));
    for (const key of new Set([...this.locals.keys(), ...next.keys()])) {
      const before = this.locals.get(key), after = next.get(key);
      if (before === after) continue;
      this.dirtyKeys.add(key);
      const group = this.memberships.get(key);
      if (group && (!!before?.manual !== !!after?.manual || this.retained(before) !== this.retained(after) || this.clearedPin(before) !== this.clearedPin(after))) this.dirtyGroups.add(group);
    }
    this.locals = next;
  }

  private retained(local?: CacheLocalState) {return !!local?.manual && local.downloaded;}
  private clearedPin(local?: CacheLocalState) {return !!local?.manual && local.cleared && !local.pdfCachePresent;}

  private pin(local?: CacheLocalState): CacheTask | undefined {
    if (!this.pdfAvailable || !local?.manual || !local.pdfId || !/^[\w-]+$/.test(local.pdfId)) return;
    if (local.pdfOwner !== undefined && !/^[\w-]+$/.test(local.pdfOwner)) return;
    const key = bookmarkCacheKey(local.pdfId, local.pdfOwner);
    if (key !== local.id) return;
    return {id: local.pdfId, key, owner: local.pdfOwner, domain: local.pdfOwner ? 'collection' : 'personal', pdf: true};
  }

  refresh(): Set<string> {
    const changed = this.dirtyKeys;
    this.dirtyKeys = new Set();
    for (const group of this.dirtyGroups) {
      for (const key of this.windows.get(group) ?? []) {this.window.delete(key); this.selected.delete(key); changed.add(key);}
      const window = new Set<string>();
      let count = 0;
      for (const candidate of this.groups.get(group) ?? []) {
        if (!candidate.success) continue;
        const local = this.locals.get(candidate.key), pdf = candidate.pdf && this.pdfAvailable;
        if (this.retained(local) || (pdf && this.clearedPin(local))) continue;
        if (!(pdf && local?.manual)) {if (count >= this.limit) continue; count++;}
        window.add(candidate.key); this.window.add(candidate.key); changed.add(candidate.key);
        const task = {id: candidate.id, key: candidate.key, owner: candidate.owner, domain: candidate.domain, pdf};
        const previous = this.tasks.get(candidate.key);
        this.selected.set(candidate.key, previous && sameTask(previous, task) ? previous : task);
      }
      if (window.size) this.windows.set(group, window); else this.windows.delete(group);
    }
    this.dirtyGroups.clear();
    for (const key of changed) {
      const local = this.locals.get(key), task = this.pin(local) ?? this.selected.get(key);
      if (!task || local?.downloaded) this.tasks.delete(key);
      else {
        const previous = this.tasks.get(key);
        if (!previous || !sameTask(previous, task)) this.tasks.set(key, task);
      }
    }
    return changed;
  }
}
