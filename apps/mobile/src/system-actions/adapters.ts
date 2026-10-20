import type {MobileDataRuntime} from '../data/runtime';
import {SaveURLController, type SaveReceipt} from './controller';
import {SystemSurfacesController, type SurfaceState} from './system-surfaces';
import type {SystemCatalogBookmark} from '../data/repositories/types';
import {SystemEntryRouter, type SystemEntryReceipt} from './entry-router';

const JOURNAL_KEY = '_slax_system_action_save_url_v1';
function decodeJournal(value: unknown): SaveReceipt[] {
  if (typeof value !== 'string') return [];
  try {const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && typeof item.url === 'string') as SaveReceipt[] : [];} catch {return [];}
}

/** Infrastructure adapters are assembled with the production runtime, outside presentation. */
export function createSaveURLController(runtime: MobileDataRuntime, removeInvocation: (id: string) => Promise<void>) {
  return new SaveURLController({
    journal: {
      async read() {return decodeJournal((await runtime.preferences.read())[JOURNAL_KEY]);},
      async write(receipts) {await runtime.preferences.update(values => {values[JOURNAL_KEY] = JSON.stringify(receipts);});},
    },
    save: (url, title, signal) => runtime.api.addBookmarkUrl(url, title, signal),
    removeInvocation,
    currentOwner() {
      const session = runtime.sessions.getSnapshot(), generation = runtime.getNativeResourceOwner();
      return session.status === 'authenticated' && generation ? {userId: session.session.userId, origin: runtime.api.options.baseUrl, generation} : null;
    },
    ready() {return runtime.getUpgradeSnapshot().status === 'ready' && runtime.credentials?.getSnapshot().status === 'ready' && Boolean(runtime.getNativeResourceOwner());},
  });
}

const SURFACE_STATE_KEY = '_slax_system_surface_state_v1';
export function createSystemSurfacesController(runtime: MobileDataRuntime, appIntents: {
  setEntityCatalogAsync: (kind: string, entities: Parameters<typeof import('expo-app-intents').setEntityCatalogAsync>[1]) => Promise<void>;
  deleteDonationsAsync: (filter: {intent: string}) => Promise<string[]>;
  donateIntentAsync: (name: string, params: {bookmarkId: string}) => Promise<string | null>;
}) {
  const read = async () => {
    const value = (await runtime.preferences.read())[SURFACE_STATE_KEY];
    if (typeof value !== 'string') return {};
    try {return JSON.parse(value) as SurfaceState;} catch {return {};}
  };
  const write = async (state: SurfaceState) => {await runtime.preferences.update(values => {values[SURFACE_STATE_KEY] = JSON.stringify(state);});};
  return new SystemSurfacesController({
    read, write,
    setCatalog: appIntents.setEntityCatalogAsync,
    deleteDonations: appIntents.deleteDonationsAsync,
    donate: appIntents.donateIntentAsync,
    watchSnapshot(onRows: (rows: SystemCatalogBookmark[]) => void, onError: () => void) {
      return runtime.getRepositories()?.watchSystemCatalog(onRows, onError) ?? (() => {});
    },
    currentOwner() {
      const session = runtime.sessions.getSnapshot(), generation = runtime.getNativeResourceOwner();
      return session.status === 'authenticated' && generation && runtime.getUpgradeSnapshot().status === 'ready' && runtime.credentials?.getSnapshot().status === 'ready'
        ? {userId: session.session.userId, origin: runtime.api.options.baseUrl, generation} : null;
    },
  });
}

const ENTRY_RECEIPTS_KEY = '_slax_system_entry_receipts_v1';
export function createSystemEntryRouter(runtime: MobileDataRuntime, systemSurfaces: SystemSurfacesController, removeInvocation: (id: string) => Promise<void>) {
  let navigate: ((id: string) => void) | null = null;
  const router = new SystemEntryRouter({
    async read() {
      const value = (await runtime.preferences.read())[ENTRY_RECEIPTS_KEY];
      if (typeof value !== 'string') return [];
      try {return JSON.parse(value) as SystemEntryReceipt[];} catch {return [];}
    },
    async write(receipts) {await runtime.preferences.update(values => {values[ENTRY_RECEIPTS_KEY] = JSON.stringify(receipts);});},
    currentOwner() {
      const session = runtime.sessions.getSnapshot(), generation = runtime.getNativeResourceOwner();
      return session.status === 'authenticated' && generation ? {userId: session.session.userId, origin: runtime.api.options.baseUrl, generation} : null;
    },
    ready() {return Boolean(navigate && runtime.sessions.getSnapshot().status === 'authenticated' && runtime.getUpgradeSnapshot().status === 'ready' && runtime.credentials?.getSnapshot().status === 'ready' && runtime.getRepositories() && runtime.getNativeResourceOwner());},
    async getBookmark(id) {
      const preferences = await runtime.preferences.read();
      const value = preferences[SURFACE_STATE_KEY];
      let mapped: string | undefined, ownerKey = '';
      const session = runtime.sessions.getSnapshot(), generation = runtime.getNativeResourceOwner();
      if (session.status === 'authenticated' && generation) ownerKey = JSON.stringify([session.session.userId, runtime.api.options.baseUrl]);
      if (typeof value === 'string') {try {const state = JSON.parse(value) as SurfaceState; if (state.catalogOwner === ownerKey || state.donationOwner === ownerKey) mapped = state.catalogIdMap?.[id];} catch {}}
      return mapped ? runtime.getRepositories()?.getSystemBookmark(mapped) ?? null : null;
    },
    navigate(id) {navigate?.(id);}, removeInvocation,
    donate: (bookmarkId, invocationId) => systemSurfaces.donateCatalogOpen(bookmarkId, invocationId),
  });
  return {router, setNavigator(value: ((id: string) => void) | null) {navigate = value; void router.contextChanged();}};
}
