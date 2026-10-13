import {mainRefreshAt} from './token-policy.ts';
import {throwIfAborted} from '../utils/abort.ts';

export type CredentialReadinessState = {status: 'idle' | 'checking' | 'ready' | 'paused'} | {status: 'retry'; code: 'refresh_unavailable'; retryAt: number} | {status: 'reauthentication-required'};
export class CredentialsUnavailableError extends Error {
  readonly code = 'credentials_unavailable';
  constructor() {super('Account credentials are awaiting refresh'); this.name = 'CredentialsUnavailableError';}
}
export class OfflineCredentialError extends CredentialsUnavailableError {
  constructor() {super(); this.name = 'OfflineCredentialError';}
}
export class ReauthenticationRequiredError extends Error {
  readonly code = 'reauthentication_required';
  constructor() {super('Sign in again to restore network access'); this.name = 'ReauthenticationRequiredError';}
}
export const isOfflineCredentialError = (error: unknown): error is OfflineCredentialError => error instanceof OfflineCredentialError;
const isOfflineRefreshFailure = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && (error.code === 'network_unavailable' || error.code === 'request_timeout');
interface SessionValue {token: string; userId: string; refreshedAt: number}
export interface CredentialReadinessOptions {
  read(): Promise<SessionValue | null>;
  refresh(signal: AbortSignal): Promise<void>;
  changed(): void;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}
export class CredentialReadiness {
  private options: CredentialReadinessOptions;
  private foreground = true;
  private epoch = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private pending?: Promise<void>;
  private retryAt = 0;
  private failures = 0;
  private offlineFailure = false;
  private rejected = false;
  private state: CredentialReadinessState = {status: 'idle'};
  private listeners = new Set<(state: CredentialReadinessState) => void>();
  constructor(options: CredentialReadinessOptions) {this.options = options;}
  getSnapshot = () => this.state;
  subscribe = (listener: (state: CredentialReadinessState) => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private emit(state: CredentialReadinessState) {this.state = state; this.listeners.forEach(listener => listener(state));}
  private now() {return (this.options.now ?? Date.now)();}
  private clearTimer() {if (this.timer !== undefined) (this.options.clearTimer ?? clearTimeout)(this.timer); this.timer = undefined;}
  private schedule(at: number) {
    this.clearTimer(); if (!this.foreground || this.rejected) return;
    this.timer = (this.options.setTimer ?? setTimeout)(() => {this.timer = undefined; void this.ensure().catch(() => undefined);}, Math.max(1, Math.min(at - this.now(), 2147483647)));
  }
  ensure = (): Promise<void> => {
    if (this.rejected) return Promise.reject(new ReauthenticationRequiredError());
    if (this.pending) return this.pending;
    if (!this.foreground) return Promise.reject(new CredentialsUnavailableError());
    const epoch = this.epoch, request = new AbortController(); this.request = request;
    const check = () => {if (this.rejected) throw new ReauthenticationRequiredError(); throwIfAborted(request.signal); if (epoch !== this.epoch || !this.foreground) throw new CredentialsUnavailableError();};
    const work = (async () => {
      let session: SessionValue | null;
      try {session = await this.options.read();}
      catch (error) {if (epoch === this.epoch && !request.signal.aborted && error instanceof ReauthenticationRequiredError) this.reject(); throw error;}
      check();
      if (!session) {this.clearTimer(); this.emit({status: 'ready'}); return;}
      const dueAt = mainRefreshAt(session, this.now() / 1000) * 1000;
      if (dueAt > this.now()) {this.failures = 0; this.retryAt = 0; this.offlineFailure = false; this.emit({status: 'ready'}); this.schedule(dueAt); return;}
      if (this.retryAt > this.now()) {this.schedule(this.retryAt); throw this.offlineFailure ? new OfflineCredentialError() : new CredentialsUnavailableError();}
      this.emit({status: 'checking'});
      try {
        await this.options.refresh(request.signal); check();
        const current = await this.options.read(); check();
        if (current && mainRefreshAt(current, this.now() / 1000) <= this.now() / 1000) throw new CredentialsUnavailableError();
        this.failures = 0; this.retryAt = 0; this.offlineFailure = false; this.emit({status: 'ready'});
        if (current) this.schedule(mainRefreshAt(current, this.now() / 1000) * 1000);
        this.options.changed();
      } catch (error) {
        if (epoch === this.epoch && !request.signal.aborted && error instanceof ReauthenticationRequiredError) {this.reject(); throw error;}
        check();
        this.offlineFailure = isOfflineRefreshFailure(error);
        this.retryAt = this.now() + Math.min(300000, 5000 * 2 ** Math.min(this.failures++, 6));
        this.emit({status: 'retry', code: 'refresh_unavailable', retryAt: this.retryAt}); this.schedule(this.retryAt);
        throw this.offlineFailure ? new OfflineCredentialError() : error;
      }
    })().finally(() => {if (this.pending === work) {this.pending = undefined; this.request = undefined;}});
    this.pending = work; return work;
  };
  reject() {this.rejected = true; this.epoch++; this.clearTimer(); this.request?.abort(); this.pending = undefined; this.request = undefined; this.offlineFailure = false; this.emit({status: 'reauthentication-required'});}
  retry(): Promise<void> {this.retryAt = 0; return this.ensure();}
  pause() {this.foreground = false; this.epoch++; this.clearTimer(); this.request?.abort(); this.pending = undefined; this.request = undefined; this.emit({status: this.rejected ? 'reauthentication-required' : 'paused'});}
  resume(): Promise<void> {this.foreground = true; return this.ensure();}
  reset() {this.epoch++; this.clearTimer(); this.request?.abort(); this.pending = undefined; this.request = undefined; this.rejected = false; this.offlineFailure = false; this.retryAt = 0; this.failures = 0; this.emit({status: 'idle'});}
}
