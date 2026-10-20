import type {MobileRepositories} from '../data/repositories.ts';
import type {WidgetLibrarySnapshot} from '../data/repositories/types.ts';
import {systemBookmarkId} from '../system-actions/catalog-policy.ts';
import type {WidgetRouteMap} from './route-map.ts';
import {
  ReadingSessionController,
  WidgetSnapshotController,
  type ActivityPort,
  type WidgetOwner,
  type WidgetPreferences,
  type WidgetSnapshotPort,
} from './controller.ts';

export type WidgetBoundary = WidgetSnapshotPort & ActivityPort;
export type WidgetCoordinatorStatus = {activityActive: boolean; failed: boolean};
export type WidgetReadPort = (owner: WidgetOwner, bookmarkId: string) => Promise<void>;

const sameOwner = (a: WidgetOwner | null, b: WidgetOwner | null) => Boolean(a && b && a.userId === b.userId && a.origin === b.origin && a.generation === b.generation);

/** Runtime composition for the repository projection and the atomic native snapshot boundary. */
export class WidgetRuntimeCoordinator {
  readonly snapshots: WidgetSnapshotController;
  private readonly activity: ReadingSessionController;
  private readonly boundary: WidgetBoundary;
  private readonly writeRouteMap: (value: WidgetRouteMap) => Promise<void>;
  private readonly writeRead: WidgetReadPort;
  private owner: WidgetOwner | null = null;
  private preferences: WidgetPreferences = {titlesEnabled: false, countEnabled: false};
  private unsubscribe?: () => void;
  private listeners = new Set<(status: WidgetCoordinatorStatus) => void>();
  private active = false;
  private failed = false;
  private status: WidgetCoordinatorStatus = {activityActive: false, failed: false};
  private latestSource?: WidgetLibrarySnapshot;
  private readCount = 0;
  private completedReads = new Set<string>();
  private expiryTimer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private sessionGeneration = 0;
  private routeSerial: Promise<void> = Promise.resolve();
  private sessionExpiresAt = 0;
  private sessionGoal = 5;

  constructor(boundary: WidgetBoundary, writeRouteMap: (value: WidgetRouteMap) => Promise<void>, writeRead: WidgetReadPort) {
    this.boundary = boundary;
    this.writeRouteMap = writeRouteMap;
    this.writeRead = writeRead;
    const thisCoordinator = this;
    this.snapshots = new WidgetSnapshotController({
      async nextVersion() {try {return await boundary.nextVersion();} catch (error) {thisCoordinator.report(thisCoordinator.active, true); throw error;}},
      async publish(snapshot) {try {return await boundary.publish(snapshot);} catch (error) {thisCoordinator.report(thisCoordinator.active, true); throw error;}},
      async revoke(snapshot) {try {await boundary.revoke(snapshot);} catch (error) {thisCoordinator.report(thisCoordinator.active, true); throw error;}},
      async reload() {try {await boundary.reload();} catch (error) {thisCoordinator.report(thisCoordinator.active, true); throw error;}},
    });
    this.activity = new ReadingSessionController(boundary);
    this.snapshots.subscribe(status => this.report(this.active, status.state === 'error'));
  }

  subscribe = (listener: (status: WidgetCoordinatorStatus) => void) => {this.listeners.add(listener); return () => this.listeners.delete(listener);};
  getSnapshot = (): WidgetCoordinatorStatus => this.status;
  canStart = () => {try {return Boolean(this.owner && this.boundary.supported());} catch {return false;}};
  activate() {this.snapshots.activate();}
  private report(active = this.active, failed = this.failed) {this.active = active; this.failed = failed; this.status = {activityActive: active, failed}; this.listeners.forEach(listener => listener(this.status));}

  private persistRoutes(map: WidgetRouteMap, current: () => boolean, source?: WidgetLibrarySnapshot, owner?: WidgetOwner) {
    const next = this.routeSerial.then(async () => {
      if (!current()) return;
      await this.writeRouteMap(map);
      if (!current() || !source || !owner) return;
      const ownerKey = JSON.stringify([owner.userId, owner.origin]);
      const projected = {...source, suggestions: this.preferences.titlesEnabled ? source.suggestions.map(item => ({...item, id: systemBookmarkId(ownerKey, item.id), unread: true, archived: false, deleted: false})) : []};
      await this.snapshots.publish(projected, owner);
      if (current()) this.report(this.active, false);
    });
    this.routeSerial = next.catch(() => undefined);
    return next;
  }

  configure(owner: WidgetOwner | null, repositories: MobileRepositories | null, preferences: WidgetPreferences) {
    const generation = ++this.generation;
    const ownerChanged = !sameOwner(this.owner, owner);
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.owner = owner ? {...owner} : null;
    this.preferences = {...preferences};
    if (ownerChanged) {this.sessionGeneration++; this.clearActivityTimer(); this.readCount = 0; this.completedReads.clear(); this.report(false);}
    this.snapshots.configure(this.owner, this.preferences);
    void this.activity.setOwner(this.owner).then(() => {
      if (generation === this.generation && (!this.owner || !sameOwner(this.owner, owner))) {this.clearActivityTimer(); this.report(false);}
    });
    const ownerKey = owner ? JSON.stringify([owner.userId, owner.origin]) : '';
    const current = () => generation === this.generation;
    if (!preferences.titlesEnabled || !owner) void this.persistRoutes({owner: ownerKey, ids: {}}, current).catch(() => this.report(this.active, true));
    if (!owner || !repositories || (!preferences.titlesEnabled && !preferences.countEnabled)) return;
    const captured = {...owner};
    const isCurrent = () => current() && sameOwner(captured, this.owner);
    this.unsubscribe = repositories.watchWidgetSnapshot(source => {
      if (!isCurrent()) return;
      this.latestSource = source;
      const scopedOwnerKey = JSON.stringify([captured.userId, captured.origin]);
      const ids = this.preferences.titlesEnabled ? Object.fromEntries(source.suggestions.map(item => [systemBookmarkId(scopedOwnerKey, item.id), item.id])) : {};
      void this.persistRoutes({owner: scopedOwnerKey, ids}, isCurrent, source, captured).catch(() => this.report(this.active, true));
    }, () => {this.report(this.active, true);});
  }

  startReadingSession(goal = 5, durationMs = 60 * 60 * 1000) {
    const owner = this.owner ? {...this.owner} : null;
    if (!owner || !this.boundary.supported()) return Promise.resolve(false);
    if (this.active) return Promise.resolve(true);
    const sessionGeneration = ++this.sessionGeneration;
    const generation = this.generation;
    this.readCount = 0;
    this.completedReads.clear();
    this.sessionGoal = Math.max(1, Math.min(10_000, Math.floor(goal)));
    this.sessionExpiresAt = Date.now() + Math.max(60_000, Math.min(12 * 60 * 60_000, durationMs));
    return this.activity.start(goal, durationMs).then(() => {
      if (generation === this.generation && sessionGeneration === this.sessionGeneration && sameOwner(owner, this.owner)) {this.report(true, false); this.clearActivityTimer(); this.expiryTimer = setInterval(() => {
        if (Date.now() >= this.sessionExpiresAt) void this.stopReadingSession();
        else void this.activity.markStale().catch(() => {if (generation === this.generation && sessionGeneration === this.sessionGeneration && sameOwner(owner, this.owner)) this.report(this.active, true);});
      }, 60_000); return true;}
      return false;
    }).catch(() => {if (generation === this.generation && sessionGeneration === this.sessionGeneration && sameOwner(owner, this.owner)) this.report(false, true); return false;});
  }

  stopReadingSession() {
    const owner = this.owner ? {...this.owner} : null, generation = this.generation;
    this.sessionGeneration++;
    this.clearActivityTimer();
    this.report(false);
    return this.activity.stop().then(() => {if (generation === this.generation && (!owner || sameOwner(owner, this.owner))) this.report(false, false);}, () => {if (generation === this.generation && (!owner || sameOwner(owner, this.owner))) this.report(false, true);});
  }

  async markRead(bookmarkId: string) {
    if (!this.active || !bookmarkId || this.completedReads.has(bookmarkId) || !this.owner) return false;
    const owner = {...this.owner}, sessionGeneration = this.sessionGeneration;
    await this.writeRead(owner, bookmarkId);
    if (sessionGeneration !== this.sessionGeneration || !sameOwner(owner, this.owner) || !this.active || this.completedReads.has(bookmarkId)) return false;
    this.completedReads.add(bookmarkId);
    this.readCount++;
    try {
      await this.activity.updateReadCount(this.readCount);
      if (sessionGeneration === this.sessionGeneration && sameOwner(owner, this.owner) && this.readCount >= this.sessionGoal) {
        this.sessionGeneration++; this.clearActivityTimer(); this.report(false);
      }
    } catch {if (sessionGeneration === this.sessionGeneration && sameOwner(owner, this.owner)) this.report(this.active, true);}
    return true;
  }

  foreground(active: boolean) {
    const generation = this.generation, owner = this.owner ? {...this.owner} : null;
    const current = () => generation === this.generation && (!owner || sameOwner(owner, this.owner));
    if (active) void this.boundary.reload().catch(() => {if (current()) this.report(this.active, true);});
    if (this.active) {
      if (Date.now() >= this.sessionExpiresAt) void this.stopReadingSession();
      else void this.activity.markStale().catch(() => {if (current()) this.report(this.active, true);});
    }
  }

  retry() {
    const owner = this.owner, source = this.latestSource;
    if (!owner) {
      const generation = this.generation;
      return Promise.all([this.snapshots.retry(), this.persistRoutes({owner: '', ids: {}}, () => generation === this.generation)])
        .then(() => this.report(this.active, false), () => this.report(this.active, true));
    }
    if (!source) {
      const generation = this.generation, ownerKey = JSON.stringify([owner.userId, owner.origin]);
      return Promise.all([this.snapshots.retry(), this.persistRoutes({owner: ownerKey, ids: {}}, () => generation === this.generation && sameOwner(owner, this.owner))])
        .then(() => this.report(this.active, false), () => this.report(this.active, true));
    }
    const generation = this.generation;
    const ownerKey = JSON.stringify([owner.userId, owner.origin]);
    const ids = this.preferences.titlesEnabled ? Object.fromEntries(source.suggestions.map(item => [systemBookmarkId(ownerKey, item.id), item.id])) : {};
    return this.persistRoutes({owner: ownerKey, ids}, () => generation === this.generation && sameOwner(owner, this.owner), source, owner)
      .then(() => this.report(this.active, false), () => this.report(this.active, true));
  }

  private clearActivityTimer() {if (this.expiryTimer) clearInterval(this.expiryTimer); this.expiryTimer = undefined;}

  dispose() {
    const generation = ++this.generation;
    this.sessionGeneration++;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.owner = null;
    void this.snapshots.dispose();
    void this.persistRoutes({owner: '', ids: {}}, () => generation === this.generation).catch(() => this.report(false, true));
    this.clearActivityTimer();
    void this.activity.stop();
    this.report(false);
    this.listeners.clear();
  }
}
