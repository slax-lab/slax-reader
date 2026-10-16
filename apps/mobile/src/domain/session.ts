import { PreferenceStore, PREFERENCE_KEYS as K } from '../data/preferences.ts';
import type { PreferenceValues } from '../data/preferences.ts';
import {mainRefreshAt} from './token-policy.ts';
import {throwIfAborted} from '../utils/abort.ts';
import {ReauthenticationRequiredError} from './credential-readiness.ts';

export interface Session { token: string; userId: string; refreshedAt: number }
export type SessionState = { status: 'loading' } | { status: 'unauthenticated' } | { status: 'authenticated'; session: Session };
export class SessionChangedError extends Error {
  constructor() { super('Account changed before request credentials could be used'); this.name = 'SessionChangedError'; }
}
export class SessionAccountMismatchError extends Error {
  readonly code = 'session_account_mismatch';
  constructor() {super('Sign in with the same account to keep your offline changes'); this.name = 'SessionAccountMismatchError';}
}
export interface SessionRequestScope {
  getSession(): Promise<Session | null>;
  assertCurrent(): void;
}
export interface SessionAuthority {
  getSession(): Promise<Session | null>;
  clearIfMatches(token: string, scope?: SessionRequestScope): Promise<boolean>;
  rejectIfMatches?(token: string, scope?: SessionRequestScope): Promise<boolean>;
  /** Capture before the first await; fixture authorities may provide fixed credentials instead. */
  captureRequestScope?(): SessionRequestScope;
  prepareRequest?(): Promise<void>;
  captureIdentity?(): () => void;
}
export interface AccountLifecycle {
  revoke?(): void;
  rejected?(): void;
  accepted?(): void;
  failed?(error: unknown): void;
  /** Clear/disconnect old account data before permitting another account to render. */
  leave(userId: string | null, clear: boolean): Promise<void>;
  enter(session: Session): Promise<void>;
}
const REAUTHENTICATION = '_slax_reauthentication_required_v1';
const SIGN_OUT_PENDING = '_slax_sign_out_pending_v1';
function storedSession(values: PreferenceValues): Session | null {
  return typeof values[K.token] === 'string' && values[K.token] && typeof values[K.userId] === 'string' && values[K.userId]
    ? { token: String(values[K.token]), userId: String(values[K.userId]), refreshedAt: Number(values[K.lastRefresh] ?? 0) }
    : null;
}
function clearTokens(values: PreferenceValues) {
  [K.token, K.userId, K.syncToken, K.syncRefresh, K.syncEndpoint, K.syncApiOrigin, K.syncUserId, REAUTHENTICATION, SIGN_OUT_PENDING, '_slax_account_cleanup_required_v1'].forEach(key => delete values[key]);
}

export class SessionController implements SessionAuthority {
  private state: SessionState = { status: 'loading' };
  private listeners = new Set<(state: SessionState) => void>();
  private serial: Promise<unknown> = Promise.resolve();
  private activeUser: string | null = null;
  private accountCleared = false;
  private requestEpoch = 0;
  private identityEpoch = 0;
  captureIdentity = () => {const epoch = this.identityEpoch; return () => {if (epoch !== this.identityEpoch) throw new SessionChangedError();};};
  private credentialsAvailable = true;
  private refreshFlight?: {epoch: number; promise: Promise<void>; signal?: AbortSignal};
  private requestPreparation?: () => Promise<void>;
  setRequestPreparation(prepare: () => Promise<void>) {this.requestPreparation = prepare;}
  prepareRequest = async () => {await this.requestPreparation?.();};
  readonly preferences: PreferenceStore;
  private lifecycle: AccountLifecycle;
  private now: () => number;
  constructor(preferences: PreferenceStore, lifecycle: AccountLifecycle, now = () => Date.now() / 1000) {
    this.preferences = preferences; this.lifecycle = lifecycle; this.now = now;
  }
  getSnapshot = (): SessionState => this.state;
  subscribe = (listener: (state: SessionState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit(state: SessionState) {
    const previous = this.state;
    if (previous.status === state.status && (state.status !== 'authenticated' || previous.status === 'authenticated' && previous.session.token === state.session.token && previous.session.userId === state.session.userId && previous.session.refreshedAt === state.session.refreshedAt)) return;
    this.state = state; this.listeners.forEach(listener => listener(state));
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(work, work);
    this.serial = result.then(() => undefined, () => undefined);
    return result;
  }
  private readStoredSession = async (): Promise<Session | null> => storedSession(await this.preferences.read());
  captureRequestScope = (): SessionRequestScope => {
    const epoch = this.requestEpoch;
    const assertCurrent = () => {
      if (epoch !== this.requestEpoch || !this.credentialsAvailable) throw new SessionChangedError();
    };
    return {assertCurrent, getSession: async () => {
      assertCurrent();
      const values = await this.preferences.read();
      assertCurrent();
      if (values[SIGN_OUT_PENDING] === true) throw new SessionChangedError();
      if (values[REAUTHENTICATION] === true) throw new ReauthenticationRequiredError();
      return storedSession(values);
    }};
  };
  getSession = (): Promise<Session | null> => this.captureRequestScope().getSession();
  private async enterAccount(session: Session) {
    const current = this.captureIdentity();
    try { await this.lifecycle.enter(session); }
    catch (error) {current(); this.requestEpoch++; this.credentialsAvailable = false; this.lifecycle.failed?.(error); throw error;}
  }
  releaseLocalOwner() {this.activeUser = null; this.requestEpoch++; this.identityEpoch++;}
  restoreLocal(prepare: () => Promise<PreferenceValues> = () => this.preferences.read()): Promise<Session | null> {
    const current = this.captureIdentity();
    return this.exclusive(async () => {
      current();
      this.requestEpoch++; this.credentialsAvailable = true;
      const values = await prepare(); current();
      const session = values[SIGN_OUT_PENDING] === true ? null : storedSession(values);
      this.identityEpoch++;
      this.emit(session ? {status: 'authenticated', session} : {status: 'unauthenticated'});
      return session;
    });
  }
  restore(): Promise<Session | null> {
    return this.exclusive(async () => {
      const current = this.captureIdentity();
      const values = await this.preferences.read(); current();
      const session = values[SIGN_OUT_PENDING] === true ? null : storedSession(values);
      if (session) {
        this.credentialsAvailable = true;
        if (values._slax_account_cleanup_required_v1 === true) {
          await this.lifecycle.leave(this.activeUser, true); current();
          this.activeUser = null;
          await this.preferences.update(next => {current(); delete next._slax_account_cleanup_required_v1;}); current();
        }
        if (this.activeUser !== session.userId) await this.enterAccount(session);
        current(); this.activeUser = session.userId;
        this.accountCleared = false;
        this.emit({status: 'authenticated', session});
      } else {
        if (this.state.status !== 'unauthenticated') this.emit({status: 'loading'});
        const priorUser = this.activeUser;
        this.activeUser = null; this.accountCleared = false;
        await this.lifecycle.leave(priorUser, true); current();
        await this.preferences.update(next => {current(); clearTokens(next);}); current();
        this.accountCleared = true;
        this.credentialsAvailable = true;
        this.emit({status: 'unauthenticated'});
      }
      return session;
    });
  }
  accept(token: string, userId: string, onStarted?: (assertCurrent: () => void) => void): Promise<Session> {
    return this.acceptSession(token, userId, onStarted);
  }
  reauthenticate(token: string, userId: string, onStarted?: (assertCurrent: () => void) => void): Promise<Session> {
    const state = this.state;
    if (state.status !== 'authenticated' || state.session.userId !== userId) return Promise.reject(new SessionAccountMismatchError());
    return this.acceptSession(token, userId, onStarted, state.session.userId);
  }
  private acceptSession(token: string, userId: string, onStarted?: (assertCurrent: () => void) => void, expectedUserId?: string): Promise<Session> {
    if (!token || !userId) return Promise.reject(new Error('Login response is missing the session'));
    const identity = this.captureIdentity();
    return this.exclusive(async () => {
      identity();
      const stored = await this.preferences.read(), previous = storedSession(stored); identity();
      if (stored[SIGN_OUT_PENDING] === true) throw new SessionChangedError();
      if (expectedUserId !== undefined && (previous?.userId !== expectedUserId || stored._slax_account_cleanup_required_v1 === true)) throw new SessionAccountMismatchError();
      this.requestEpoch++; this.identityEpoch++; this.credentialsAvailable = false;
      const current = this.captureIdentity();
      onStarted?.(current);
      const clear = !!(stored._slax_account_cleanup_required_v1 === true || previous && previous.userId !== userId || !previous && (!this.accountCleared || this.activeUser !== null));
      const priorUser = previous?.userId ?? this.activeUser;
      if (clear) {this.lifecycle.revoke?.(); this.activeUser = null; this.accountCleared = false;}
      const refreshedAt = Math.floor(this.now()), session = {token, userId, refreshedAt};
      await this.preferences.update(values => {
        current();
        if (expectedUserId !== undefined && (values[K.userId] !== expectedUserId || values[SIGN_OUT_PENDING] === true || values._slax_account_cleanup_required_v1 === true)) throw new SessionAccountMismatchError();
        delete values[K.syncToken]; delete values[K.syncRefresh]; delete values[K.syncEndpoint]; delete values[K.syncApiOrigin]; delete values[K.syncUserId]; delete values[REAUTHENTICATION];
        if (clear) values._slax_account_cleanup_required_v1 = true;
        values[K.token] = token; values[K.userId] = userId; values[K.lastRefresh] = String(refreshedAt);
        values._slax_session_revision_v1 = Number(values._slax_session_revision_v1 ?? 0) + 1;
      });
      current();
      if (!clear || this.lifecycle.revoke) this.emit({status: 'authenticated', session});
      try {
        if (clear) {
          await this.lifecycle.leave(priorUser, true); current();
          await this.preferences.update(values => {current(); delete values._slax_account_cleanup_required_v1;}); current();
          this.accountCleared = true;
        }
      } catch (error) {current(); this.lifecycle.failed?.(error); throw error;}
      this.credentialsAvailable = true;
      if (this.activeUser !== userId) await this.enterAccount(session);
      current(); this.activeUser = userId;
      this.accountCleared = false;
      this.lifecycle.accepted?.();
      this.emit({status: 'authenticated', session});
      return session;
    });
  }
  async rejectIfMatches(token: string, scope?: SessionRequestScope): Promise<boolean> {
    const epoch = this.requestEpoch;
    let rejected = false;
    await this.preferences.update(values => {
      rejected = false;
      if (epoch !== this.requestEpoch || !this.credentialsAvailable) return;
      try {scope?.assertCurrent();} catch {return;}
      if (values[K.token] !== token) return;
      values[REAUTHENTICATION] = true;
      delete values[K.syncToken]; delete values[K.syncRefresh]; delete values[K.syncEndpoint]; delete values[K.syncApiOrigin]; delete values[K.syncUserId];
      rejected = true;
    });
    if (!rejected || epoch !== this.requestEpoch) return false;
    this.requestEpoch++;
    this.lifecycle.rejected?.();
    return true;
  }
  clearIfMatches(token: string, scope?: SessionRequestScope): Promise<boolean> {
    return this.exclusive(async () => {
      try { scope?.assertCurrent(); } catch (error) { if (error instanceof SessionChangedError) return false; throw error; }
      const previous = await this.readStoredSession();
      try { scope?.assertCurrent(); } catch (error) { if (error instanceof SessionChangedError) return false; throw error; }
      if (!previous || previous.token !== token) return false;
      let requested = false;
      await this.preferences.update(values => {
        scope?.assertCurrent(); requested = values[K.token] === token;
        if (requested) values[SIGN_OUT_PENDING] = true;
      });
      if (!requested) return false;
      this.requestEpoch++; this.identityEpoch++; this.credentialsAvailable = false;
      const identity = this.captureIdentity();
      this.emit({ status: 'loading' });
      this.activeUser = null; this.accountCleared = false;
      try {
        await this.lifecycle.leave(previous.userId, true); identity();
        let cleared = false;
        await this.preferences.update(values => {
          identity();
          cleared = false;
          if (values[K.token] === token) { clearTokens(values); cleared = true; }
        });
        this.activeUser = null;
        this.accountCleared = true;
        const current = await this.readStoredSession(); identity();
        this.credentialsAvailable = true;
        if (current) { await this.enterAccount(current); this.activeUser = current.userId; this.accountCleared = false; }
        this.emit(current ? { status: 'authenticated', session: current } : { status: 'unauthenticated' });
        return cleared;
      } catch (error) {identity(); this.lifecycle.failed?.(error); throw error;}
    });
  }
  async signOut(): Promise<void> {
    const scope = this.captureRequestScope();
    const session = await this.readStoredSession();
    scope.assertCurrent();
    if (session) await this.clearIfMatches(session.token, scope);
  }
  refreshIfNeeded(refresh: (token: string, signal?: AbortSignal) => Promise<string>, signal?: AbortSignal, assertCurrent = () => {}): Promise<void> {
    if (this.refreshFlight?.epoch === this.requestEpoch && !this.refreshFlight.signal?.aborted) return this.refreshFlight.promise;
    const epoch = this.requestEpoch, scope = this.captureRequestScope();
    const check = () => {throwIfAborted(signal); scope.assertCurrent(); assertCurrent();};
    const promise = (async () => {
      const prior = await scope.getSession(); check();
      if (!prior || mainRefreshAt(prior, this.now()) > this.now()) return;
      const token = await refresh(prior.token, signal); throwIfAborted(signal); assertCurrent();
      if (!token) throw new Error('Refresh response is missing the session');
      await this.exclusive(async () => {
        try {check();} catch (error) {if (error instanceof SessionChangedError) return; throw error;}
        let accepted = false;
        const values = await this.preferences.update(next => {
          check(); accepted = false;
          if (next[REAUTHENTICATION] === true) throw new ReauthenticationRequiredError();
          if (next[K.token] !== prior.token || next[K.userId] !== prior.userId) return;
          next[K.token] = token; next[K.lastRefresh] = String(Math.floor(this.now()));
          delete next[K.syncToken]; delete next[K.syncRefresh]; delete next[K.syncEndpoint]; delete next[K.syncApiOrigin]; delete next[K.syncUserId];
          accepted = true;
        });
        const session = storedSession(values);
        if (accepted && session) {this.requestEpoch++; if (this.state.status === 'authenticated') this.emit({status: 'authenticated', session});}
      });
    })().finally(() => {if (this.refreshFlight?.promise === promise) this.refreshFlight = undefined;});
    this.refreshFlight = {epoch, promise, signal}; return promise;
  }
}
