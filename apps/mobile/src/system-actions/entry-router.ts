import type {SaveURLInvocation, SystemActionOwner} from './controller';
import type {SystemCatalogBookmark} from '../data/repositories/types.ts';

export type SystemEntryReceipt = {id: string; bookmarkId: string; status: 'complete' | 'unavailable' | 'discarded'; acked?: boolean};
const MAX_ENTRY_RECEIPTS = 200;
export type SystemEntryPorts = {
  read(): Promise<SystemEntryReceipt[]>; write(receipts: SystemEntryReceipt[]): Promise<void>;
  currentOwner(): SystemActionOwner | null; ready(): boolean;
  getBookmark(id: string): Promise<SystemCatalogBookmark | null>;
  navigate(id: string): void; removeInvocation(id: string): Promise<void>;
  donate(bookmarkId: string, invocationId: string): Promise<void>;
};
const sameOwner = (a: SystemActionOwner | null, b: SystemActionOwner | null) => Boolean(a && b && a.userId === b.userId && a.origin === b.origin && a.generation === b.generation);

/** Queues Spotlight invocations until current local admission and navigation are both ready. */
export class SystemEntryRouter {
  private ports: SystemEntryPorts;
  private pending = new Map<string, SaveURLInvocation>();
  private serial: Promise<void> = Promise.resolve();
  private listeners = new Set<(receipt: SystemEntryReceipt | null) => void>();
  private snapshot: SystemEntryReceipt | null = null;
  private disposed = false;
  constructor(ports: SystemEntryPorts) {this.ports = ports;}
  activate() {this.disposed = false;}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: (receipt: SystemEntryReceipt | null) => void) => {this.listeners.add(listener); return () => this.listeners.delete(listener);};
  private emit(value: SystemEntryReceipt | null) {if (!this.disposed) {this.snapshot = value; this.listeners.forEach(listener => listener(value));}}
  receive(invocations: SaveURLInvocation[]) {
    for (const item of invocations) if (item.name === 'openBookmark' && typeof item.params.bookmarkId === 'string') this.pending.set(item.id, item);
    return this.drain();
  }
  contextChanged() {return this.drain();}
  private drain() {
    const work = this.serial.then(async () => {
      if (this.disposed || !this.ports.ready()) return;
      const owner = this.ports.currentOwner(); if (!owner) return;
      const receipts = await this.ports.read();
      if (this.disposed || !this.ports.ready() || !sameOwner(owner, this.ports.currentOwner())) return;
      for (const [id, invocation] of this.pending) {
        if (this.disposed || !this.ports.ready() || !sameOwner(owner, this.ports.currentOwner())) return;
        const existing = receipts.find(item => item.id === id);
        if (existing?.status === 'unavailable') {this.emit(existing); continue;}
        if (existing?.status === 'complete' || existing?.status === 'discarded') {await this.acknowledge(existing, receipts); this.pending.delete(id); continue;}
        const bookmarkId = invocation.params.bookmarkId;
        if (typeof bookmarkId !== 'string') continue;
        if (receipts.length >= MAX_ENTRY_RECEIPTS) {
          // Only acknowledged tombstones are safe to compact; unacknowledged native entries
          // stay queued until the journal has room again.
          for (let index = receipts.length - 1; index >= 0 && receipts.length >= MAX_ENTRY_RECEIPTS; index--) {
            if (receipts[index]?.acked) receipts.splice(index, 1);
          }
          if (receipts.length >= MAX_ENTRY_RECEIPTS) return;
        }
        const bookmark = await this.ports.getBookmark(bookmarkId);
        if (this.disposed || !this.ports.ready() || !sameOwner(owner, this.ports.currentOwner())) return;
        if (!bookmark || bookmark.archiveStatus !== 0 || bookmark.status !== 'success') {
          const unavailable = {id, bookmarkId, status: 'unavailable' as const};
          receipts.push(unavailable); await this.ports.write(receipts); this.emit(unavailable); continue;
        }
        this.ports.navigate(bookmark.id);
        await this.ports.donate(bookmarkId, id);
        if (this.disposed || !sameOwner(owner, this.ports.currentOwner())) return;
        const complete = {id, bookmarkId, status: 'complete' as const, acked: false};
        receipts.push(complete); await this.ports.write(receipts); this.emit(null);
        await this.acknowledge(complete, receipts); this.pending.delete(id);
      }
    });
    this.serial = work.catch(() => undefined); return work;
  }
  private async acknowledge(item: SystemEntryReceipt, receipts: SystemEntryReceipt[]) {
    try {await this.ports.removeInvocation(item.id); item.acked = true; await this.ports.write(receipts);}
    catch { /* Durable receipt remains for a later queue replay. */ }
  }
  discardUnavailable(id: string) {
    const work = this.serial.then(async () => {
      const receipts = await this.ports.read(), item = receipts.find(value => value.id === id);
      if (!item || item.status !== 'unavailable') return;
      item.status = 'discarded'; item.acked = false; await this.ports.write(receipts); this.emit(null);
      await this.acknowledge(item, receipts); this.pending.delete(id);
    });
    this.serial = work.catch(() => undefined); return work;
  }
  dispose() {this.disposed = true; this.pending.clear(); this.listeners.clear();}
}
