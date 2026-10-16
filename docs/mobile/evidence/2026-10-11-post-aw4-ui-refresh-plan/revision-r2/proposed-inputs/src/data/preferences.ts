export type PreferenceValue = string | number | boolean | string[];
export type PreferenceValues = Record<string, PreferenceValue>;
export interface PreferenceSnapshot { revision: number; values: PreferenceValues }

/** Native implementations must perform compare-and-swap under a cross-process lock. */
export interface PreferenceStorage {
  read(): Promise<PreferenceSnapshot>;
  compareAndSwap(revision: number, values: PreferenceValues): Promise<boolean>;
}

export const PREFERENCE_KEYS = {
  token: 'auth_token', userId: 'user_id', lastRefresh: 'last_refresh_time',
  syncRefresh: 'powersync_refresh_time', syncToken: 'powersync_token', syncEndpoint: 'powersync_connect_url',
  syncApiOrigin: 'powersync_api_origin',
  continueReading: 'continue_reading_bookmark', detailDoNotAlert: 'user_setting_detail_do_not_alert',
  language: 'user_language', cacheCount: 'cache_count', downloadImages: 'download_images',
  environment: 'selected_env', deviceId: 'analytics_device_id',
} as const;

export class PreferenceStore {
  private listeners = new Set<(values: PreferenceValues) => void>();
  private assertActive: () => void;
  readonly storage: PreferenceStorage;
  constructor(storage: PreferenceStorage, assertActive = () => {}) { this.storage = storage; this.assertActive = assertActive; }
  scoped(assertActive: () => void): PreferenceStore {
    const scope = new PreferenceStore(this.storage, () => {this.assertActive(); assertActive();});
    scope.listeners = this.listeners;
    return scope;
  }
  async read(): Promise<PreferenceValues> { this.assertActive(); const snapshot = await this.storage.read(); this.assertActive(); return snapshot.values; }
  subscribe(listener: (values: PreferenceValues) => void): () => void {
    this.assertActive();
    const guarded = (values: PreferenceValues) => {try {this.assertActive();} catch {return;} listener(values);};
    this.listeners.add(guarded);
    return () => this.listeners.delete(guarded);
  }
  async update(edit: (values: PreferenceValues) => void): Promise<PreferenceValues> {
    for (let attempts = 0; attempts < 32; attempts++) {
      this.assertActive();
      const { revision, values } = await this.storage.read();
      this.assertActive();
      const next: PreferenceValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
      edit(next);
      this.assertActive();
      if (await this.storage.compareAndSwap(revision, next)) {
        this.assertActive();
        this.listeners.forEach(listener => listener(next));
        return next;
      }
    }
    throw new Error('Preference storage is busy; no data was overwritten');
  }
  async settings() {
    const values = await this.read();
    return {
      language: typeof values.user_language === 'string' ? values.user_language : null,
      cacheCount: typeof values.cache_count === 'number' ? values.cache_count : 50,
      downloadImages: (values.download_images ?? 1) === 1,
      detailDoNotAlert: values.user_setting_detail_do_not_alert === 'true',
      environment: typeof values.selected_env === 'string' ? values.selected_env : null,
    };
  }
  async deviceId(generate: () => string): Promise<string> {
    const values = await this.update(next => { if (!next.analytics_device_id) next.analytics_device_id = generate(); });
    return String(values.analytics_device_id);
  }
}

export interface ContinueReadingContext {
  bookmarkId: string; title: string; collectionOwnerId?: string | null; collectionId?: string | null;
}
export async function readContinueReading(preferences: PreferenceStore): Promise<ContinueReadingContext | null> {
  const value = (await preferences.read()).continue_reading_bookmark;
  if (typeof value !== 'string') return null;
  try {
    const context = JSON.parse(value) as ContinueReadingContext;
    return typeof context.bookmarkId === 'string' && typeof context.title === 'string' ? context : null;
  } catch { return null; }
}
