import type {PowerSyncCredentials} from '@powersync/common';
import {SessionChangedError} from '../domain/session.ts';
import type {SessionAuthority} from '../domain/session.ts';
import {jwtTiming, SYNC_EXPECTED_LIFETIME_SECONDS, syncTokenExpiresAt} from '../domain/token-policy.ts';
import {throwIfAborted} from '../utils/abort.ts';
import {PreferenceStore, PREFERENCE_KEYS as K} from './preferences.ts';
import {uploadPendingTransactions} from './uploader.ts';
import type {CrudQueue} from './uploader.ts';
import type {SlaxApi} from './api.ts';

export function createSyncConnector(api: SlaxApi, preferences: PreferenceStore, sessions: SessionAuthority, localEndpoint?: string, now = Date.now) {
  let generation = 0, paused = false, initialCache = true;
  let flight: {generation: number; promise: Promise<PowerSyncCredentials | null>; request: AbortController} | undefined;
  const fetchCredentials = (): Promise<PowerSyncCredentials | null> => {
    if (flight?.generation === generation) return flight.promise;
    if (paused) return Promise.resolve(null);
    const expected = generation, request = new AbortController(), identity = sessions.captureIdentity?.(), apiOrigin = api.options.baseUrl;
    const promise = (async () => {
      let scope: ReturnType<NonNullable<SessionAuthority['captureRequestScope']>> | undefined;
      const check = () => {throwIfAborted(request.signal); identity?.(); scope?.assertCurrent(); if (paused || expected !== generation || api.options.baseUrl !== apiOrigin) throw new SessionChangedError();};
      try {
        await sessions.prepareRequest?.(); check(); scope = sessions.captureRequestScope?.();
        const session = await (scope ? scope.getSession() : sessions.getSession()); check();
        if (!session) return null;
        const values = await preferences.read(); check();
        const endpoint = values[K.syncEndpoint], token = values[K.syncToken], refreshed = values[K.syncRefresh];
        const expiresAt = typeof token === 'string' && typeof refreshed === 'number' ? syncTokenExpiresAt(token, session.userId, refreshed, now()) : null;
        if (initialCache && expiresAt && values[K.token] === session.token && values[K.userId] === session.userId && values[K.syncUserId] === session.userId && values[K.syncApiOrigin] === apiOrigin && typeof endpoint === 'string' && endpoint && (!localEndpoint || endpoint === localEndpoint)) {
          initialCache = false; return {endpoint, token: token as string, expiresAt};
        }
        initialCache = false;
        await preferences.update(next => {
          check();
          if (next[K.token] === session.token && next[K.userId] === session.userId) {
            delete next[K.syncToken]; delete next[K.syncRefresh]; delete next[K.syncEndpoint]; delete next[K.syncApiOrigin]; delete next[K.syncUserId];
          }
        });
        check();
        const received = await api.getSyncToken(request.signal); check();
        const fetchedAt = now(), expiration = syncTokenExpiresAt(received.token, session.userId, fetchedAt, fetchedAt);
        const credentials = {endpoint: localEndpoint ?? received.endpoint, token: received.token, expiresAt: expiration ?? undefined};
        if (!credentials.endpoint || !expiration) throw new Error('Invalid or expired synchronization credentials');
        const timing = jwtTiming(received.token)!;
        if (timing.iat !== undefined && timing.exp - timing.iat !== SYNC_EXPECTED_LIFETIME_SECONDS) console.warn('sync_credential_lifetime_contract_mismatch', {issuedLifetimeSeconds: timing.exp - timing.iat});
        let accepted = false;
        await preferences.update(next => {
          check(); accepted = next[K.token] === session.token && next[K.userId] === session.userId;
          if (!accepted) return;
          next[K.syncEndpoint] = credentials.endpoint; next[K.syncToken] = credentials.token; next[K.syncRefresh] = fetchedAt;
          next[K.syncApiOrigin] = apiOrigin; next[K.syncUserId] = session.userId;
        });
        check(); return accepted ? credentials : null;
      } catch (error) {
        if (error instanceof SessionChangedError || request.signal.aborted) return null;
        try {check();} catch {return null;}
        throw error;
      }
    })().finally(() => {if (flight?.promise === promise) flight = undefined;});
    flight = {generation: expected, promise, request}; return promise;
  };
  return {
    fetchCredentials,
    async prepareConnection() {const credentials = await fetchCredentials(); if (credentials) initialCache = true; return credentials;},
    pause() {paused = true; generation++; flight?.request.abort(); flight = undefined;},
    resume() {paused = false; initialCache = true;},
    invalidate() {generation++; flight?.request.abort(); flight = undefined; initialCache = false;},
    async uploadData(database: CrudQueue): Promise<void> {await sessions.prepareRequest?.(); if (paused) return; await uploadPendingTransactions(database, changes => api.uploadChanges(changes));},
  };
}
