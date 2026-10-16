import type {SessionState} from '../domain/session.ts'
import type {PreferenceStore, PreferenceValues} from '../data/preferences.ts'
import {PREFERENCE_KEYS} from '../data/preferences.ts'

export interface ReaderAccountOwnership {owner: string | null; currentOwner: string | null}
export function readerAccountActive(state: SessionState, userId: string, ownership?: ReaderAccountOwnership): boolean {
  return Boolean(userId) && state.status === 'authenticated' && state.session.userId === userId &&
    (!ownership || Boolean(ownership.owner) && ownership.owner === ownership.currentOwner)
}

/** Recheck ownership on CAS retries, including a logout before React unmounts the reader. */
export async function updateReaderPreferences(
  preferences: PreferenceStore, userId: string, snapshot: () => SessionState,
  edit: (values: PreferenceValues) => void, ownsAccount: () => boolean = () => true,
): Promise<void> {
  if (!readerAccountActive(snapshot(), userId) || !ownsAccount()) return
  await preferences.update(values => {
    if (readerAccountActive(snapshot(), userId) && ownsAccount() && values[PREFERENCE_KEYS.userId] === userId) edit(values)
  })
}
