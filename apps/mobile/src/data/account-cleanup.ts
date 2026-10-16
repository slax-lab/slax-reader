import type {PowerSyncDatabase} from '@powersync/react-native';
import {PREFERENCE_KEYS as K} from './preferences.ts';
import type {PreferenceStore} from './preferences.ts';

/** Run only after the database has passed the upgrade ownership/verification barrier. */
export async function clearAccountData(database: Pick<PowerSyncDatabase, 'disconnectAndClear'>, cache: {clearArticles(): void} | null, preferences: PreferenceStore, revokeNativeResources: () => Promise<void>): Promise<void> {
  await revokeNativeResources();
  await database.disconnectAndClear({clearLocal: true});
  cache?.clearArticles();
  await preferences.update(next => {delete next[K.continueReading];});
}
