import type {SystemCatalogBookmark} from '../data/repositories/types.ts';
import {systemBookmarkId, toBookmarkEntities, type BookmarkEntity} from './catalog-policy.ts';
import type {SystemActionOwner} from './controller.ts';

export const BOOKMARK_ENTITY_KIND = 'bookmark';
export const OPEN_BOOKMARK_INTENT = 'openBookmark';
export type SurfaceState = {catalogOwner?: string; donationOwner?: string; catalogBookmarkIds?: string[]; catalogIdMap?: Record<string, string>; revokedCatalog?: boolean; revokedDonations?: boolean; donatedActions?: string[]; donationAttempts?: string[]; pendingDonations?: {actionId: string; bookmarkId: string; owner: string; queued?: true}[]; donationIds?: string[]; error?: 'catalog' | 'donation' | 'revocation'};
type SurfacePorts = {
  read(): Promise<SurfaceState>; write(state: SurfaceState): Promise<void>;
  setCatalog(kind: string, entities: BookmarkEntity[]): Promise<void>;
  deleteDonations(filter: {intent: string}): Promise<string[]>;
  donate(name: string, params: {bookmarkId: string}): Promise<string | null>;
  watchSnapshot(onRows: (rows: SystemCatalogBookmark[]) => void, onError: () => void): () => void;
  currentOwner(): SystemActionOwner | null;
};
const ownerKey = (owner: SystemActionOwner | null) => owner ? JSON.stringify([owner.userId, owner.origin]) : '';

/** Opt-in catalog owner/revocation coordinator. Every async publish is fenced to its captured runtime. */
export class SystemSurfacesController {
  private readonly ports: SurfacePorts;
  private serial: Promise<void> = Promise.resolve();
  private unsubscribe?: () => void;
  private pendingRows?: SystemCatalogBookmark[];
  private publishingRows = false;
  private generation = 0;
  private enabled = false;
  private donationsEnabled = false;
  private disposed = false;
  private error = false;
  private listeners = new Set<(failed: boolean) => void>();
  constructor(ports: SurfacePorts) {this.ports = ports;}
  activate() {this.disposed = false;}
  subscribe = (listener: (failed: boolean) => void) => {this.listeners.add(listener); return () => this.listeners.delete(listener);};
  getSnapshot = () => this.error;
  private report(failed: boolean) {this.error = failed; this.listeners.forEach(listener => listener(failed));}
  private enqueue(work: () => Promise<void>) {const next = this.serial.then(work, work); this.serial = next.catch(() => undefined); return next;}
  reconcile(enabled: boolean, donationsEnabled: boolean, ready = true) {
    this.enabled = enabled; this.donationsEnabled = donationsEnabled;
    const generation = ++this.generation; this.unsubscribe?.(); this.unsubscribe = undefined;
    return this.enqueue(async () => {
      if (this.disposed || generation !== this.generation) return;
      const owner = this.ports.currentOwner(), key = ownerKey(owner), state = await this.ports.read();
      if (this.disposed || generation !== this.generation) return;
      const catalogMustRevoke = Boolean(state.catalogOwner && (!key || key !== state.catalogOwner || !enabled));
      const donationOwner = state.donationOwner ?? state.catalogOwner;
      const donationsMustRevoke = Boolean(donationOwner && (!key || key !== donationOwner || !donationsEnabled));
      if (catalogMustRevoke || donationsMustRevoke || state.revokedCatalog || state.revokedDonations) {
        await this.ports.write({...state, revokedCatalog: catalogMustRevoke || Boolean(state.revokedCatalog), revokedDonations: donationsMustRevoke || Boolean(state.revokedDonations)});
        try {
          if (catalogMustRevoke || state.revokedCatalog) {await this.ports.setCatalog(BOOKMARK_ENTITY_KIND, []); state.catalogOwner = undefined; state.catalogBookmarkIds = []; state.catalogIdMap = {}; state.revokedCatalog = false;}
          if (donationsMustRevoke || state.revokedDonations) {await this.ports.deleteDonations({intent: OPEN_BOOKMARK_INTENT}); state.donationOwner = undefined; state.donationIds = []; state.donatedActions = []; state.donationAttempts = []; state.pendingDonations = []; state.revokedDonations = false;}
          await this.ports.write(state);
        } catch {this.report(true); return;}
      }
      if (this.disposed || generation !== this.generation || !key) return;
      if (!ready) return;
      if (enabled || donationsEnabled) {
        const current = () => !this.disposed && generation === this.generation && ownerKey(this.ports.currentOwner()) === key;
        this.unsubscribe = this.ports.watchSnapshot(rows => {
          if (!current()) return;
          this.pendingRows = rows;
          if (this.publishingRows) return;
          this.publishingRows = true;
          void this.enqueue(async () => {
            while (current() && this.pendingRows) {
              const latestRows = this.pendingRows; this.pendingRows = undefined;
              const projected = toBookmarkEntities(latestRows, key);
              const entities = this.enabled ? projected : [];
              await this.publishSnapshot(current, key, entities, projected, latestRows);
            }
            this.publishingRows = false;
          }).catch(() => {this.publishingRows = false;});
        }, () => {if (current()) this.report(true);});
      }
    });
  }
  private async publishSnapshot(current: () => boolean, key: string, entities: BookmarkEntity[], projected: BookmarkEntity[], rows: SystemCatalogBookmark[]) {
            if (!current()) return;
            try {
              const previous = await this.ports.read();
              const ids = projected.map(entity => entity.id);
              const removed = previous.catalogBookmarkIds?.some(id => !ids.includes(id)) ?? false;
              if (removed && (previous.donationIds?.length || previous.pendingDonations?.length || previous.donationAttempts?.length)) {
                previous.revokedDonations = true;
                await this.ports.write(previous);
                await this.ports.deleteDonations({intent: OPEN_BOOKMARK_INTENT});
                previous.revokedDonations = false; previous.donationOwner = undefined;
                previous.donationIds = []; previous.donatedActions = []; previous.donationAttempts = []; previous.pendingDonations = [];
                await this.ports.write(previous);
              }
              if (!current()) return;
              if (this.enabled) await this.ports.setCatalog(BOOKMARK_ENTITY_KIND, entities);
              const next = await this.ports.read(); next.catalogOwner = key; next.catalogBookmarkIds = ids;
              next.catalogIdMap = Object.fromEntries(projected.map(entity => [entity.id, rows.find(row => systemBookmarkId(key, row.id) === entity.id)?.id]).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
              await this.ports.write(next);
              if (current()) this.report(false);
            }
            catch {if (current()) this.report(true);}
  }
  private donationWork(actionId: string, bookmarkId: string, key: string, generation: number) {
    const runtimeGeneration = this.ports.currentOwner()?.generation;
    return this.enqueue(async () => {
      if (!runtimeGeneration || this.disposed || generation !== this.generation || ownerKey(this.ports.currentOwner()) !== key || this.ports.currentOwner()?.generation !== runtimeGeneration || !this.donationsEnabled) return;
      const state = await this.ports.read();
      if (this.disposed || generation !== this.generation || ownerKey(this.ports.currentOwner()) !== key || this.ports.currentOwner()?.generation !== runtimeGeneration || !this.donationsEnabled) return;
      const actions = state.donatedActions ?? [], pending = state.pendingDonations ?? [];
      if (actions.includes(actionId) || state.donationAttempts?.includes(actionId) || pending.some(item => item.actionId === actionId)) return;
      const catalogId = bookmarkId.startsWith('b-') ? bookmarkId : systemBookmarkId(key, bookmarkId);
      state.pendingDonations = [...pending.slice(-99), {actionId, bookmarkId: catalogId, owner: key, queued: true}]; state.donationOwner = key;
      if (!bookmarkId.startsWith('b-')) state.catalogIdMap = {...state.catalogIdMap, [catalogId]: bookmarkId};
      await this.ports.write(state);
      await this.performDonation(actionId, catalogId, key, generation, runtimeGeneration);
    });
  }
  async donateSuccessfulOpen(bookmarkId: string, actionId: string) {
    const owner = this.ports.currentOwner(), key = ownerKey(owner), generation = this.generation;
    if (this.disposed || !key || !this.donationsEnabled) return;
    await this.donationWork(actionId, bookmarkId, key, generation);
  }
  async donateCatalogOpen(bookmarkId: string, actionId: string) {
    const owner = this.ports.currentOwner(), key = ownerKey(owner), generation = this.generation;
    if (this.disposed || !key || !this.donationsEnabled) return;
    await this.donationWork(actionId, bookmarkId, key, generation);
  }
  private async performDonation(actionId: string, bookmarkId: string, key: string, generation: number, runtimeGeneration: string) {
    const current = () => !this.disposed && generation === this.generation && ownerKey(this.ports.currentOwner()) === key && this.ports.currentOwner()?.generation === runtimeGeneration && this.donationsEnabled;
    try {
      if (!current()) return;
      const state = await this.ports.read();
      if (!current()) return;
      const pending = state.pendingDonations?.find(item => item.actionId === actionId && item.owner === key);
      if (!pending) return;
      if (state.donatedActions?.includes(actionId) || state.donationAttempts?.includes(actionId) || !pending.queued) {
        // The OS supplies its identifier only after acceptance. An interrupted admitted attempt
        // may have succeeded, so consume its pending receipt without donating the action again.
        if (!pending.queued && !state.donationAttempts?.includes(actionId)) state.donationAttempts = [...(state.donationAttempts ?? []).slice(-199), actionId];
        state.pendingDonations = (state.pendingDonations ?? []).filter(item => item.actionId !== actionId);
        await this.ports.write(state);
        if (current()) this.report(false);
        return;
      }
      state.donationAttempts = [...(state.donationAttempts ?? []).slice(-199), actionId];
      await this.ports.write(state);
      if (!current()) return;
      let id: string | null;
      try {id = await this.ports.donate(OPEN_BOOKMARK_INTENT, {bookmarkId});}
      catch {
        if (!current()) return;
        const failed = await this.ports.read();
        if (!current()) return;
        // Only an explicit native rejection permits retry. A later journal failure must retain
        // the admission marker because the OS may already have recorded the donation.
        failed.donationAttempts = (failed.donationAttempts ?? []).filter(value => value !== actionId);
        await this.ports.write(failed);
        if (current()) this.report(true);
        return;
      }
      if (!current()) return;
      const latest = await this.ports.read();
      if (!current()) return;
      latest.pendingDonations = (latest.pendingDonations ?? []).filter(item => item.actionId !== actionId);
      latest.donationAttempts = (latest.donationAttempts ?? []).filter(value => value !== actionId);
      latest.donatedActions = [...(latest.donatedActions ?? []).slice(-199), actionId];
      latest.donationIds = [...(latest.donationIds ?? []).slice(-199), ...(id ? [id] : [])];
      await this.ports.write(latest);
      if (current()) this.report(false);
    } catch {if (current()) this.report(true);}
  }
  async retryPendingDonations() {
    const owner = this.ports.currentOwner(), key = ownerKey(owner), generation = this.generation;
    if (this.disposed || !owner || !key || !this.donationsEnabled) return;
    await this.enqueue(async () => {
      const state = await this.ports.read();
      for (const item of state.pendingDonations ?? []) {
        if (this.disposed || generation !== this.generation || ownerKey(this.ports.currentOwner()) !== key || this.ports.currentOwner()?.generation !== owner.generation || !this.donationsEnabled) return;
        if (item.owner === key) await this.performDonation(item.actionId, item.bookmarkId, key, generation, owner.generation);
      }
    });
  }
  dispose() {this.disposed = true; this.generation++; this.unsubscribe?.(); this.unsubscribe = undefined; this.listeners.clear();}
}
