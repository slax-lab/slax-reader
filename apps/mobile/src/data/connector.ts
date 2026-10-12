import {SessionChangedError} from '../domain/session.ts';
import type { SessionAuthority } from '../domain/session.ts';
import { PreferenceStore, PREFERENCE_KEYS as K } from './preferences.ts';
import { uploadPendingTransactions } from './uploader.ts';
import type { CrudQueue } from './uploader.ts';
import type { SlaxApi, SyncCredentials } from './api.ts';

export function createSyncConnector(api: SlaxApi, preferences: PreferenceStore, sessions: SessionAuthority, localEndpoint?: string, now = Date.now) {
  return {
    async fetchCredentials(): Promise<SyncCredentials | null> {
      const scope = sessions.captureRequestScope?.();
      try {
        const session = await (scope ? scope.getSession() : sessions.getSession());
        scope?.assertCurrent();
        if (!session) return null;
        const apiOrigin = api.options.baseUrl;
        const values = await preferences.read();
        scope?.assertCurrent();
        const endpoint = values[K.syncEndpoint], token = values[K.syncToken], refreshed = values[K.syncRefresh];
        if (values[K.token] === session.token && values[K.userId] === session.userId && values[K.syncApiOrigin] === apiOrigin && typeof endpoint === 'string' && typeof token === 'string' && typeof refreshed === 'number' && now() - refreshed < 3600000 && (!localEndpoint || endpoint === localEndpoint)) return {endpoint, token};
        const received = await api.getSyncToken();
        scope?.assertCurrent();
        const credentials = {endpoint: localEndpoint ?? received.endpoint, token: received.token};
        if (!credentials.endpoint || !credentials.token) throw new Error('No synchronization credentials');
        let accepted = false;
        await preferences.update(next => {
          scope?.assertCurrent();
          accepted = next[K.token] === session.token && next[K.userId] === session.userId && api.options.baseUrl === apiOrigin;
          if (!accepted) return;
          next[K.syncEndpoint] = credentials.endpoint; next[K.syncToken] = credentials.token; next[K.syncRefresh] = now(); next[K.syncApiOrigin] = apiOrigin;
        });
        scope?.assertCurrent();
        return accepted ? credentials : null;
      } catch (error) {if (error instanceof SessionChangedError) return null; throw error;}
    },
    async uploadData(database: CrudQueue): Promise<void> { await uploadPendingTransactions(database, changes => api.uploadChanges(changes)); },
  };
}
