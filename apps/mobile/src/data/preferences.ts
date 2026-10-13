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
  syncApiOrigin: 'powersync_api_origin', syncUserId: 'powersync_user_id',
  continueReading: 'continue_reading_bookmark', detailDoNotAlert: 'user_setting_detail_do_not_alert',
  language: 'user_language', cacheCount: 'cache_count', downloadImages: 'download_images',
  environment: 'selected_env', deviceId: 'analytics_device_id',
} as const;

function samePreferences(left: PreferenceValues, right: PreferenceValues): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    const before = left[key], after = right[key];
    if (Array.isArray(before) || Array.isArray(after)) {
      return Array.isArray(before) && Array.isArray(after) && before.length === after.length
        && before.every((value, index) => Object.is(value, after[index]));
    }
    return Object.is(before, after);
  });
}

function copyPreferences(values: PreferenceValues): PreferenceValues {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
}

export class PreferenceStore {
  private listeners = new Set<(values: PreferenceValues) => void>();
  private observation: {snapshot?: PreferenceSnapshot} = {};
  private assertActive: () => void;
  readonly storage: PreferenceStorage;
  constructor(storage: PreferenceStorage, assertActive = () => {}) { this.storage = storage; this.assertActive = assertActive; }
  scoped(assertActive: () => void): PreferenceStore {
    const scope = new PreferenceStore(this.storage, () => {this.assertActive(); assertActive();});
    scope.listeners = this.listeners;
    scope.observation = this.observation;
    return scope;
  }
  private observe(snapshot: PreferenceSnapshot): void {
    this.assertActive();
    const previous = this.observation.snapshot;
    if (previous && snapshot.revision < previous.revision) return;
    const changed = !previous || !samePreferences(previous.values, snapshot.values);
    this.observation.snapshot = {revision: snapshot.revision, values: changed ? copyPreferences(snapshot.values) : previous.values};
    const failures: unknown[] = [];
    if (changed) this.listeners.forEach(listener => {
      try {listener(snapshot.values);} catch (error) {failures.push(error);}
    });
    this.assertActive();
    if (failures.length) throw failures[0];
  }
  async read(): Promise<PreferenceValues> { this.assertActive(); const snapshot = await this.storage.read(); this.observe(snapshot); return snapshot.values; }
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
      const next = copyPreferences(values);
      edit(next);
      this.assertActive();
      if (samePreferences(values, next)) {this.observe({revision, values}); return values;}
      if (await this.storage.compareAndSwap(revision, next)) {
        this.observe({revision: revision + 1, values: next});
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
    const existing = (await this.read()).analytics_device_id;
    this.assertActive();
    if (existing) return String(existing);
    let generated: string | undefined;
    const values = await this.update(next => { if (!next.analytics_device_id) next.analytics_device_id = generated ??= generate(); });
    this.assertActive();
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
