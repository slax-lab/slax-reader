export type WidgetOwner = {userId: string; origin: string; generation: string};
export type WidgetSuggestion = {id: string; title: string; savedAt: number; unread: boolean; archived: boolean; deleted: boolean};
export type WidgetSource = {unreadCount: number; suggestions: readonly WidgetSuggestion[]};
export type WidgetSnapshot = {
  schemaVersion: 1;
  version: number;
  owner: WidgetOwner | null;
  state: 'signedOut' | 'empty' | 'ready' | 'neutral';
  updatedAt: number;
  unreadCount: number | null;
  suggestions: readonly {id: string; title?: string}[];
};
export type WidgetPreferences = {titlesEnabled: boolean; countEnabled: boolean};
export type WidgetSnapshotPort = {
  /** Allocates a durable monotonically increasing version shared with the snapshot store. */
  nextVersion(): Promise<number>;
  /** Atomically reject an obsolete version, even when its write completes after a later revoke. */
  publish(snapshot: WidgetSnapshot): Promise<boolean>;
  /** Atomically replace retained data with the supplied redacted state and persist its version fence. */
  revoke(snapshot: WidgetSnapshot): Promise<void>;
  reload(): Promise<void>;
};

export type WidgetControllerStatus = {state: 'idle' | 'pending' | 'error'; error?: 'publish' | 'revoke' | 'reload'};

const sameOwner = (a: WidgetOwner | null, b: WidgetOwner | null) =>
  Boolean(a && b && a.userId === b.userId && a.origin === b.origin && a.generation === b.generation);
const safeTitle = (title: string) => title.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);

/** Coalesces admitted local snapshots into bounded, versioned system display data. */
export class WidgetSnapshotController {
  private readonly port: WidgetSnapshotPort;
  private readonly now: () => number;
  private owner: WidgetOwner | null = null;
  private preferences: WidgetPreferences = {titlesEnabled: false, countEnabled: false};
  private latestSource?: WidgetSource;
  private serial: Promise<void> = Promise.resolve();
  private pending?: {owner: WidgetOwner | null; source?: WidgetSource; preferences: WidgetPreferences};
  private scheduled = false;
  private disposed = false;
  private epoch = 0;
  private revokeRequired = false;
  private status: WidgetControllerStatus = {state: 'idle'};
  private listeners = new Set<(status: WidgetControllerStatus) => void>();

  constructor(port: WidgetSnapshotPort, now: () => number = Date.now) {this.port = port; this.now = now;}

  subscribe = (listener: (status: WidgetControllerStatus) => void) => {this.listeners.add(listener); return () => this.listeners.delete(listener);};
  getSnapshot = () => this.status;
  private report(status: WidgetControllerStatus) {this.status = status; for (const listener of this.listeners) listener(status);}

  activate() {this.disposed = false; this.schedule();}

  configure(owner: WidgetOwner | null, preferences: WidgetPreferences) {
    if (this.disposed) return Promise.resolve();
    const changed = !sameOwner(owner, this.owner);
    const preferencesChanged = preferences.titlesEnabled !== this.preferences.titlesEnabled || preferences.countEnabled !== this.preferences.countEnabled;
    this.owner = owner ? {...owner} : null;
    this.preferences = {...preferences};
    if (changed) this.latestSource = undefined;
    if (changed || preferencesChanged) {this.epoch++; this.revokeRequired = true; this.pending = undefined;}
    if (this.owner && !changed && this.latestSource) this.pending = {owner: this.owner, source: this.latestSource, preferences: this.preferences};
    else if (this.owner && changed) this.pending = {owner: this.owner, preferences: this.preferences};
    this.report({state: 'pending'});
    return this.schedule();
  }

  publish(source: WidgetSource, owner = this.owner) {
    if (this.disposed || !owner || !sameOwner(owner, this.owner)) return Promise.resolve();
    this.latestSource = this.sanitizeSource(source);
    this.pending = {owner: {...owner}, source: this.latestSource, preferences: {...this.preferences}};
    this.report({state: 'pending'});
    return this.schedule();
  }

  private sanitizeSource(source: WidgetSource): WidgetSource {
    const unreadCount = Number.isFinite(source.unreadCount) ? Math.max(0, Math.floor(source.unreadCount)) : 0;
    const suggestions = source.suggestions
      .filter(item => item.unread && !item.archived && !item.deleted && typeof item.id === 'string' && item.id.length > 0)
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, 3)
      .map(item => ({id: item.id.slice(0, 256), title: safeTitle(item.title), savedAt: item.savedAt, unread: true, archived: false, deleted: false}));
    return {unreadCount, suggestions};
  }

  private schedule() {
    if (this.disposed && !this.revokeRequired) return this.serial;
    if (!this.scheduled) {
      this.scheduled = true;
      const work = this.serial.then(async () => {
        while (this.revokeRequired || this.pending) {
          if (this.revokeRequired) {
            const epoch = this.epoch;
            let operation: 'revoke' | 'reload' = 'revoke';
            try {
              const version = await this.port.nextVersion();
              if (epoch !== this.epoch) continue;
              const snapshot: WidgetSnapshot = {schemaVersion: 1, version, owner: this.owner, state: this.owner ? 'neutral' : 'signedOut', updatedAt: this.now(), unreadCount: null, suggestions: []};
              await this.port.revoke(snapshot);
              if (epoch !== this.epoch) continue;
              operation = 'reload';
              await this.port.reload();
              if (epoch !== this.epoch) continue;
              this.revokeRequired = false;
            } catch {this.report({state: 'error', error: operation}); return;}
          }
          if (!this.pending || this.disposed) break;
          const current = this.pending; this.pending = undefined;
          const epoch = this.epoch;
          let operation: 'publish' | 'reload' = 'publish';
          try {
            const version = await this.port.nextVersion();
            if (this.disposed || epoch !== this.epoch) continue;
            const {owner, source, preferences} = current;
            const hasConsent = preferences.titlesEnabled || preferences.countEnabled;
            const snapshot: WidgetSnapshot = {
              schemaVersion: 1, version, owner, state: !owner ? 'signedOut' : !hasConsent || !source ? 'neutral' : source.unreadCount ? 'ready' : 'empty',
              updatedAt: this.now(), unreadCount: owner && preferences.countEnabled && hasConsent ? source?.unreadCount ?? 0 : null,
              suggestions: owner && preferences.titlesEnabled ? (source?.suggestions ?? []).map(({id, title}) => ({id, title: title || undefined})) : [],
            };
            const accepted = await this.port.publish(snapshot);
            if (this.disposed || epoch !== this.epoch) continue;
            if (!accepted) throw new Error('Widget snapshot rejected by atomic version fence');
            operation = 'reload';
            await this.port.reload();
          } catch {
            if (!this.disposed && epoch === this.epoch) {this.pending ??= current; this.report({state: 'error', error: operation});}
            return;
          }
        }
        if (!this.revokeRequired && !this.pending) this.report({state: 'idle'});
      });
      this.serial = work.catch(() => {this.report({state: 'error', error: 'publish'});}).finally(() => {this.scheduled = false; if ((this.pending || this.revokeRequired) && !this.disposed && this.status.state === 'pending') void this.schedule();});
    }
    return this.serial;
  }

  retry() {
    if (this.disposed) return Promise.resolve();
    if (this.status.state === 'error') this.report({state: 'pending'});
    return this.schedule();
  }

  dispose() {
    this.disposed = true; this.epoch++; this.owner = null; this.latestSource = undefined; this.preferences = {titlesEnabled: false, countEnabled: false}; this.pending = undefined; this.revokeRequired = true;
    this.report({state: 'pending'});
    return this.schedule();
  }
}

export type ReadingSession = {id: string; owner: WidgetOwner; readCount: number; goal: number; startedAt: number; staleAt: number; expiresAt: number; stale: boolean};
export type ActivityPayload = Omit<ReadingSession, 'owner'>;
export type ActivityPort = {supported(): boolean; start(payload: ActivityPayload): Promise<string>; update(id: string, payload: ActivityPayload): Promise<void>; end(id: string, payload: ActivityPayload): Promise<void>};

/** User-started finite ActivityKit lifecycle; no activity is created by unread-count updates. */
export class ReadingSessionController {
  private readonly port: ActivityPort;
  private readonly now: () => number;
  private owner: WidgetOwner | null = null;
  private session?: ReadingSession;
  private activityId?: string;
  private serial: Promise<void> = Promise.resolve();
  private disposed = false;
  constructor(port: ActivityPort, now: () => number = Date.now) {this.port = port; this.now = now;}
  private enqueue(work: () => Promise<void>) {const next = this.serial.then(work, work); this.serial = next.catch(() => undefined); return next;}
  setOwner(owner: WidgetOwner | null) {
    const old = this.owner; this.owner = owner ? {...owner} : null;
    if (this.session && !sameOwner(this.session.owner, this.owner)) return this.stop();
    if (old && !sameOwner(old, this.owner)) return this.stop();
    return Promise.resolve();
  }
  start(goal: number, durationMs: number, staleAfterMs = 60_000) {
    return this.enqueue(async () => {
      const owner = this.owner;
      if (this.disposed || !owner || !this.port.supported() || this.session) return;
      const now = this.now(), boundedGoal = Math.max(1, Math.min(10_000, Math.floor(Number.isFinite(goal) ? goal : 1)));
      const duration = Number.isFinite(durationMs) ? durationMs : 60_000;
      const staleDelay = Number.isFinite(staleAfterMs) ? staleAfterMs : 60_000;
      const session: ReadingSession = {id: `${now}-${Math.random().toString(36).slice(2, 10)}`, owner: {...owner}, readCount: 0, goal: boundedGoal, startedAt: now, staleAt: now + Math.max(1_000, staleDelay), expiresAt: now + Math.max(60_000, Math.min(12 * 60 * 60_000, duration)), stale: false};
      const activityId = await this.port.start(this.payload(session));
      if (this.disposed || !sameOwner(owner, this.owner)) {await this.port.end(activityId, this.payload({...session, stale: true})); return;}
      this.session = session; this.activityId = activityId;
    });
  }
  updateReadCount(count: number) {
    return this.enqueue(async () => {
      const session = this.session, id = this.activityId;
      if (!session || !id || this.disposed || !sameOwner(session.owner, this.owner)) return;
      const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : session.readCount;
      const now = this.now();
      if (now >= session.expiresAt || safeCount >= session.goal) {session.readCount = Math.min(session.goal, safeCount); await this.port.end(id, this.payload(session)); this.session = undefined; this.activityId = undefined; return;}
      session.readCount = Math.max(session.readCount, safeCount); session.stale = false; session.staleAt = now + 60_000;
      await this.port.update(id, this.payload(session));
    });
  }
  markStale() {return this.enqueue(async () => {const session = this.session, id = this.activityId; if (!session || !id) return; if (this.now() >= session.expiresAt) {await this.port.end(id, this.payload(session)); this.session = undefined; this.activityId = undefined; return;} if (this.now() >= session.staleAt && !session.stale) {session.stale = true; await this.port.update(id, this.payload(session));}});}
  stop() {return this.enqueue(async () => {const session = this.session, id = this.activityId; if (session && id) await this.port.end(id, this.payload(session)); this.session = undefined; this.activityId = undefined;});}
  dispose() {this.disposed = true; return this.stop();}
  private payload(session: ReadingSession): ActivityPayload {const {owner: _owner, ...payload} = session; return payload;}
}
