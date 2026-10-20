export type SaveURLInvocation = {id: string; name: string; params: Record<string, unknown>; createdAt: number};

export type SystemActionOwner = {userId: string; origin: string; generation: string};
export type SaveReceipt = {
  id: string; url: string; title?: string; owner: SystemActionOwner | null;
  status: 'pending' | 'processing' | 'failed' | 'complete' | 'invalid' | 'discarded'; acked?: boolean; error?: 'save_failed' | 'invalid_url' | 'owner_changed';
};
export type SaveJournal = {read(): Promise<SaveReceipt[]>; write(receipts: SaveReceipt[]): Promise<void>};
export type SaveURLPorts = {
  journal: SaveJournal;
  save(url: string, title: string | undefined, signal: AbortSignal): Promise<unknown>;
  removeInvocation(id: string): Promise<void>;
  currentOwner(): SystemActionOwner | null;
  ready(): boolean;
};

export function validateSaveURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 16_384 || /[\u0000-\u001f\u007f]|%0[0ad]/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

const sameOwner = (a: SystemActionOwner | null, b: SystemActionOwner | null) =>
  Boolean(a && b && a.userId === b.userId && a.origin === b.origin && a.generation === b.generation);
const sameAccount = (a: SystemActionOwner | null, b: SystemActionOwner | null) =>
  Boolean(a && b && a.userId === b.userId && a.origin === b.origin);

/** Durable local receipt journal for at-least-once App Intent delivery. */
export class SaveURLController {
  private ports: SaveURLPorts;
  private abort: AbortController | null = null;
  private serial: Promise<void> = Promise.resolve();
  private disposed = false;
  private listeners = new Set<(receipts: SaveReceipt[]) => void>();
  private snapshot: SaveReceipt[] = [];
  private lastOwner: SystemActionOwner | null = null;
  constructor(ports: SaveURLPorts) {this.ports = ports;}
  subscribe = (listener: (receipts: SaveReceipt[]) => void) => {this.listeners.add(listener); return () => this.listeners.delete(listener);};
  getSnapshot = () => this.snapshot;
  private async emit() {const receipts = await this.ports.journal.read(); if (!this.disposed) {this.snapshot = receipts; this.listeners.forEach(listener => listener(receipts));}}
  private queue(work: () => Promise<void>) {const next = this.serial.then(work, work); this.serial = next.catch(() => undefined); return next;}
  activate() {this.disposed = false;}
  receive(invocations: SaveURLInvocation[]) {
    return this.queue(async () => {
      if (this.disposed) return;
      const receipts = await this.ports.journal.read();
      if (this.disposed) return;
      const byId = new Map(receipts.map(item => [item.id, item]));
      for (const invocation of invocations) {
        if (invocation.name !== 'saveURL' || byId.has(invocation.id)) continue;
        if (byId.size >= 200) break; // Keep the native invocation pending when durable capacity is full.
        const url = validateSaveURL(invocation.params.url);
        const title = typeof invocation.params.title === 'string' && !/[\u0000-\u001f\u007f]/.test(invocation.params.title)
          ? invocation.params.title.slice(0, 512) : undefined;
        byId.set(invocation.id, {id: invocation.id, url: url ?? '', ...(title ? {title} : {}), owner: null, status: url ? 'pending' : 'invalid', ...(url ? {} : {error: 'invalid_url'})});
      }
      const next = [...byId.values()];
      await this.ports.journal.write(this.bounded(next));
      await this.emit();
      await this.drain();
    });
  }
  claim(id: string) {
    return this.queue(async () => {
      const owner = this.ports.currentOwner(); if (!owner || !this.ports.ready()) return;
      const receipts = await this.ports.journal.read(), item = receipts.find(receipt => receipt.id === id);
      if (this.disposed || !sameOwner(owner, this.ports.currentOwner()) || !item || item.owner || item.status === 'invalid' || item.status === 'complete' || item.status === 'discarded') return;
      item.owner = owner; item.status = 'pending'; delete item.error;
      await this.ports.journal.write(receipts); await this.emit(); await this.drain();
    });
  }
  retry(id: string) {return this.queue(async () => {if (this.disposed) return; const receipts = await this.ports.journal.read(), item = receipts.find(value => value.id === id); if (this.disposed || !item || item.status !== 'failed') return; item.status = 'pending'; delete item.error; await this.ports.journal.write(receipts); await this.emit(); await this.drain();});}
  discard(id: string) {return this.queue(async () => {if (this.disposed) return; const receipts = await this.ports.journal.read(), item = receipts.find(value => value.id === id); if (this.disposed || !item) return; item.status = 'discarded'; delete item.error; item.acked = false; await this.ports.journal.write(this.bounded(receipts)); await this.emit(); await this.acknowledge(item, receipts);});}
  private bounded(receipts: SaveReceipt[]) {
    const acknowledged = receipts.filter(item => (item.status === 'complete' || item.status === 'discarded') && item.acked);
    if (receipts.length <= 200) return receipts;
    const remove = new Set(acknowledged.slice(0, Math.max(0, receipts.length - 200)).map(item => item.id));
    return receipts.filter(item => !remove.has(item.id));
  }
  private async acknowledge(item: SaveReceipt, receipts: SaveReceipt[]) {
    try {
      await this.ports.removeInvocation(item.id);
      item.acked = true;
      await this.ports.journal.write(this.bounded(receipts));
      await this.emit();
    } catch { /* Keep the durable receipt unacknowledged for a later replay. */ }
  }
  contextChanged() {
    const nextOwner = this.ports.currentOwner(), previousOwner = this.lastOwner;
    this.abort?.abort(new Error('System action owner changed')); this.abort = null;
    this.lastOwner = nextOwner;
    return this.queue(async () => {
      if (this.disposed) return;
      if (previousOwner && !sameAccount(previousOwner, nextOwner)) {
        const receipts = await this.ports.journal.read(); let changed = false;
        if (this.disposed) return;
        for (const item of receipts) if (!item.owner && item.status !== 'complete' && item.status !== 'discarded') {item.status = 'invalid'; item.error = 'owner_changed'; changed = true;}
        if (changed) {await this.ports.journal.write(receipts); await this.emit();}
      }
      await this.drain();
    });
  }
  private async drain() {
    const owner = this.ports.currentOwner();
    if (this.disposed || !owner || !this.ports.ready()) return;
    const receipts = await this.ports.journal.read();
    for (const item of receipts) {
      if (this.disposed || !this.ports.ready() || !sameOwner(owner, this.ports.currentOwner())) return;
      if (item.status === 'complete' || item.status === 'discarded') {if (!item.acked) await this.acknowledge(item, receipts); continue;}
      if (item.status === 'invalid' || item.status === 'failed' || !sameAccount(item.owner, owner)) continue;
      const safeURL = validateSaveURL(item.url);
      if (!safeURL) {item.status = 'invalid'; item.error = 'invalid_url'; await this.ports.journal.write(receipts); await this.emit(); continue;}
      // A process may have stopped after journaling dispatch but before recording its result.
      // Replaying the existing API action is the only recoverable outcome in that window.
      if (item.status === 'processing') item.status = 'pending';
      const controller = new AbortController(); this.abort = controller;
      item.status = 'processing';
      await this.ports.journal.write(receipts); await this.emit();
      try {
        if (this.disposed) return;
        // This synchronous fence is deliberately adjacent to API dispatch.
        if (controller.signal.aborted || !this.ports.ready() || !sameOwner(owner, this.ports.currentOwner())) throw new Error('System action owner changed');
        await this.ports.save(safeURL, item.title, controller.signal);
        if (controller.signal.aborted || !sameOwner(owner, this.ports.currentOwner())) return;
        item.status = 'complete'; delete item.error;
        await this.ports.journal.write(this.bounded(receipts)); await this.emit();
        await this.acknowledge(item, receipts);
      } catch (error) {
        if (controller.signal.aborted || !sameOwner(owner, this.ports.currentOwner())) return;
        item.status = 'failed'; item.error = 'save_failed';
        await this.ports.journal.write(receipts); await this.emit();
      } finally {if (this.abort === controller) this.abort = null;}
    }
  }
  dispose() {this.disposed = true; this.abort?.abort(new Error('System action controller disposed')); this.abort = null; this.listeners.clear();}
}
