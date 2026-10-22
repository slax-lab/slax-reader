import { requireNativeModule } from 'expo';
import type { PreferenceSnapshot, PreferenceStorage, PreferenceValues } from './preferences.ts';
import type { LegacyPreferenceSource } from './legacy-preferences.ts';
import type { DatabaseOwnership } from './upgrade.ts';
import type { DatabaseInspector } from './adoption.ts';

export interface SlaxLegacyBridge extends LegacyPreferenceSource, DatabaseOwnership, DatabaseInspector {
  readPreferences(): Promise<PreferenceSnapshot>;
  compareAndSwapPreferences(revision: number, values: PreferenceValues): Promise<boolean>;
  newIdentifier(): string;
  md5String(value: string): string;
  beginStorageTransition?(): number;
  checkStorageTransition?(token: number): void;
  endStorageTransition?(token: number): Promise<void>;
}
export function loadLegacyBridge(): SlaxLegacyBridge { return requireNativeModule<SlaxLegacyBridge>('SlaxLegacy'); }
export function nativePreferenceStorage(bridge: SlaxLegacyBridge): PreferenceStorage {
  return {
    async read() {
      const snapshot = await bridge.readPreferences();
      if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || !snapshot.values || Array.isArray(snapshot.values)) throw new Error('Invalid native preference snapshot');
      for (const value of Object.values(snapshot.values)) {
        if (!(typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (Array.isArray(value) && value.every(item => typeof item === 'string')))) throw new Error('Unsupported native preference value');
      }
      return snapshot;
    },
    compareAndSwap: (revision, values) => bridge.compareAndSwapPreferences(revision, values),
  };
}
