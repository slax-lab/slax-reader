import { PreferenceStore, PREFERENCE_KEYS as K } from '../data/preferences.ts';
import type { PreferenceValues } from '../data/preferences.ts';

export interface Session { token: string; userId: string; refreshedAt: number }
export type SessionState = { status: 'loading' } | { status: 'unauthenticated' } | { status: 'authenticated'; session: Session };
export class SessionChangedError extends Error {
  constructor() { super('Account changed before request credentials could be used'); this.name = 'SessionChangedError'; }
}
export interface SessionRequestScope {
  getSession(): Promise<Session | null>;
  assertCurrent(): void;
}
export interface SessionAuthority {
  getSession(): Promise<Session | null>;
  clearIfMatches(token: string, scope?: SessionRequestScope): Promise<boolean>;
  /** Capture before the first await; fixture authorities may provide fixed credentials instead. */
  captureRequestScope?(): SessionRequestScope;
}
export interface AccountLifecycle {
  /** Clear/disconnect old account data before permitting another account to render. */
  leave(userId: string | null, clear: boolean): Promise<void>;
  enter(session: Session): Promise<void>;
}
function storedSession(values: PreferenceValues): Session | null {
  return typeof values[K.token] === 'string' && values[K.token] && typeof values[K.userId] === 'string' && values[K.userId]
    ? { token: String(values[K.token]), userId: String(values[K.userId]), refreshedAt: Number(values[K.lastRefresh] ?? 0) }
    : null;
}
function clearTokens(values: PreferenceValues) {
  [K.token, K.userId, K.syncToken, K.syncRefresh, K.syncEndpoint, K.syncApiOrigin].forEach(key => delete values[key]);
}

export class SessionController implements SessionAuthority {
  private state: SessionState = { status: 'loading' };
  private listeners = new Set<(state: SessionState) => void>();
  private serial: Promise<unknown> = Promise.resolve();
  private activeUser: string | null = null;
  private accountCleared = false;
  private requestEpoch = 0;
  private credentialsAvailable = true;
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
  private emit(state: SessionState) { this.state = state; this.listeners.forEach(listener => listener(state)); }
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
      const session = await this.readStoredSession();
      assertCurrent();
      return session;
    }};
  };
  getSession = (): Promise<Session | null> => this.captureRequestScope().getSession();
  private async enterAccount(session: Session) {
    try { await this.lifecycle.enter(session); }
    catch (error) {this.requestEpoch++; this.credentialsAvailable = false; throw error;}
  }
  restore(): Promise<Session | null> {
    return this.exclusive(async () => {
      this.requestEpoch++; this.credentialsAvailable = false;
      const session = await this.readStoredSession();
      if (session) {
        this.credentialsAvailable = true;
        await this.enterAccount(session);
        this.activeUser = session.userId;
        this.accountCleared = false;
        this.emit({ status: 'authenticated', session });
      } else {
        // The old app can clear authentication before its database/cache cleanup finishes.
        // Runtime calls restore only after verified database adoption has completed.
        this.emit({ status: 'loading' });
        const priorUser = this.activeUser;
        this.activeUser = null; this.accountCleared = false;
        await this.lifecycle.leave(priorUser, true);
        await this.preferences.update(clearTokens);
        this.activeUser = null;
        this.accountCleared = true;
        this.credentialsAvailable = true;
        this.emit({ status: 'unauthenticated' });
      }
      return session;
    });
  }
  accept(token: string, userId: string): Promise<Session> {
    if (!token || !userId) return Promise.reject(new Error('Login response is missing the session'));
    return this.exclusive(async () => {
      this.requestEpoch++; this.credentialsAvailable = false;
      const previous = await this.readStoredSession();
      if ((previous && previous.userId !== userId) || (!previous && (!this.accountCleared || this.activeUser !== null))) {
        this.emit({ status: 'loading' });
        const priorUser = previous?.userId ?? this.activeUser;
        this.activeUser = null; this.accountCleared = false;
        await this.lifecycle.leave(priorUser, true);
        this.accountCleared = true;
      }
      const refreshedAt = Math.floor(this.now());
      await this.preferences.update(values => {
        delete values[K.syncToken]; delete values[K.syncRefresh]; delete values[K.syncEndpoint]; delete values[K.syncApiOrigin];
        values[K.token] = token; values[K.userId] = userId; values[K.lastRefresh] = String(refreshedAt);
      });
      const session = { token, userId, refreshedAt };
      this.credentialsAvailable = true;
      if (this.activeUser !== userId) await this.enterAccount(session);
      this.activeUser = userId;
      this.accountCleared = false;
      this.emit({ status: 'authenticated', session });
      return session;
    });
  }
  clearIfMatches(token: string, scope?: SessionRequestScope): Promise<boolean> {
    return this.exclusive(async () => {
      try { scope?.assertCurrent(); } catch (error) { if (error instanceof SessionChangedError) return false; throw error; }
      const previous = await this.readStoredSession();
      try { scope?.assertCurrent(); } catch (error) { if (error instanceof SessionChangedError) return false; throw error; }
      if (!previous || previous.token !== token) return false;
      this.requestEpoch++; this.credentialsAvailable = false;
      this.emit({ status: 'loading' });
      this.activeUser = null; this.accountCleared = false;
      await this.lifecycle.leave(previous.userId, true);
      let cleared = false;
      await this.preferences.update(values => {
        cleared = false;
        if (values[K.token] === token) { clearTokens(values); cleared = true; }
      });
      this.activeUser = null;
      this.accountCleared = true;
      const current = await this.readStoredSession();
      this.credentialsAvailable = true;
      if (current) { await this.enterAccount(current); this.activeUser = current.userId; this.accountCleared = false; }
      this.emit(current ? { status: 'authenticated', session: current } : { status: 'unauthenticated' });
      return cleared;
    });
  }
  async signOut(): Promise<void> {
    const scope = this.captureRequestScope();
    const session = await scope.getSession();
    if (session) await this.clearIfMatches(session.token, scope);
  }
  async refreshIfNeeded(refresh: (token: string) => Promise<string>): Promise<void> {
    const scope = this.captureRequestScope();
    const prior = await scope.getSession();
    if (!prior || this.now() - prior.refreshedAt <= 86400) return;
    const token = await refresh(prior.token);
    await this.exclusive(async () => {
      try { scope.assertCurrent(); } catch (error) { if (error instanceof SessionChangedError) return; throw error; }
      let accepted = false;
      const values = await this.preferences.update(next => {
        accepted = false;
        if (next[K.token] !== prior.token || next[K.userId] !== prior.userId) return;
        next[K.token] = token; next[K.lastRefresh] = String(Math.floor(this.now()));
        delete next[K.syncToken]; delete next[K.syncRefresh]; delete next[K.syncEndpoint]; delete next[K.syncApiOrigin];
        accepted = true;
      });
      const session = storedSession(values);
      if (accepted && session) { this.requestEpoch++; this.emit({ status: 'authenticated', session }); }
    });
  }
}
