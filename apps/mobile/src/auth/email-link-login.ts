import {EMAIL_LOGIN_PATH, EMAIL_LOGIN_WEB_PATH, EMAIL_LOGIN_WEB_ORIGINS, parseEmailLinkProof, type EmailLinkInput} from '@slax-reader/contracts/email-auth';
import type {SessionController} from '../domain/session';
import type {SlaxApi} from '../data/api';

export interface EmailLinkSource {
  initialURL(): Promise<string | null | undefined>;
  subscribe(listener: (url: string) => void): () => void;
  openURL(url: string): Promise<void>;
}
export type EmailLinkState = {status: 'idle' | 'agreement' | 'loading' | 'active' | 'failed'} | {status: 'environment'; url: string};
type Options = {
  source: EmailLinkSource;
  api: Pick<SlaxApi, 'verifyLoginEmailLink'>;
  sessions: Pick<SessionController, 'getSnapshot' | 'subscribe' | 'captureIdentity' | 'accept'>;
  webOrigin: string;
};

export function emailLinkWebOrigin(config: {apiUrl: string; betaApiUrl: string; webUrl: string}, activeApi: string): string {
  return new URL(activeApi !== config.apiUrl && activeApi === config.betaApiUrl ? EMAIL_LOGIN_WEB_ORIGINS[1] : config.webUrl).origin;
}

export class EmailLinkLoginController {
  private state: EmailLinkState = {status: 'idle'};
  private listeners = new Set<() => void>();
  private pending: {proof: EmailLinkInput; url: URL} | null = null;
  private flight: AbortController | null = null;
  private active = false;
  private committing = false;
  private generation = 0;
  private unsubscribe: (() => void) | undefined;
  private unsubscribeSession: (() => void) | undefined;
  private options: Options;
  constructor(options: Options) {this.options = options;}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private set(state: EmailLinkState) {this.state = state; this.listeners.forEach(listener => listener());}
  start(launch = {handled: false}) {
    this.active = true;
    const generation = ++this.generation;
    let previous = this.options.sessions.getSnapshot();
    let received = false;
    this.unsubscribe = this.options.source.subscribe(url => {received = true; this.receive(url);});
    this.unsubscribeSession = this.options.sessions.subscribe(() => {
      if (this.committing) return;
      const next = this.options.sessions.getSnapshot();
      const sameAccountNotice = this.state.status === 'active' && previous.status === 'authenticated' && next.status === 'authenticated' && previous.session.userId === next.session.userId;
      const ready = previous.status === 'loading' && next.status !== 'loading';
      previous = next;
      if (sameAccountNotice) return;
      if (ready) this.present();
      else this.dismiss();
    });
    if (!launch.handled) void this.options.source.initialURL().then(url => {
      if (!this.active || generation !== this.generation || launch.handled) return;
      launch.handled = true;
      if (!received && url) this.receive(url);
    }, () => {
      if (!this.active || generation !== this.generation || launch.handled) return;
      launch.handled = true;
      if (!received) this.set({status: 'failed'});
    });
  }
  private receive(value: string) {
    if (!this.active || this.committing) return;
    let url: URL;
    try {url = new URL(value);} catch {return;}
    if (url.pathname !== EMAIL_LOGIN_PATH) return;
    if (this.flight && this.pending?.url.href === url.href) return;
    this.flight?.abort(); this.flight = null; this.pending = null;
    const knownOrigin = url.origin === this.options.webOrigin || EMAIL_LOGIN_WEB_ORIGINS.some(origin => origin === url.origin);
    const proof = parseEmailLinkProof(new URLSearchParams(url.hash.slice(1)));
    if (!knownOrigin || url.username || url.password || !proof) {this.set({status: 'failed'}); return;}
    this.pending = {proof, url};
    this.present();
  }
  private present() {
    if (!this.active || !this.pending) return;
    const session = this.options.sessions.getSnapshot();
    if (session.status === 'loading') return;
    if (session.status === 'authenticated') {this.pending = null; this.set({status: 'active'}); return;}
    if (this.pending.url.origin !== this.options.webOrigin) {
      const url = new URL(EMAIL_LOGIN_WEB_PATH, this.pending.url.origin);
      url.hash = this.pending.url.hash;
      this.set({status: 'environment', url: url.href});
      return;
    }
    this.set({status: 'agreement'});
  }
  confirm = async () => {
    if (this.state.status !== 'agreement' || !this.pending || this.flight) return;
    const flight = new AbortController(); this.flight = flight;
    const current = () => this.active && this.flight === flight && !flight.signal.aborted;
    let assertIdentity = this.options.sessions.captureIdentity();
    const proof = this.pending.proof;
    this.set({status: 'loading'});
    try {
      const result = await this.options.api.verifyLoginEmailLink(proof, flight.signal);
      if (!current()) return;
      assertIdentity();
      await this.options.sessions.accept(result.token, result.user_id, guard => {assertIdentity = guard; this.committing = true;}, flight.signal);
      if (!current()) return;
      assertIdentity(); this.pending = null; this.set({status: 'idle'});
    } catch {
      if (current()) {this.pending = null; this.set({status: 'failed'});}
    } finally {this.committing = false; if (this.flight === flight) this.flight = null;}
  };
  dismiss = () => {if (this.committing) return; this.flight?.abort(); this.flight = null; this.pending = null; this.set({status: 'idle'});};
  continueOnWeb = async () => {
    if (this.state.status !== 'environment') return;
    const url = this.state.url;
    this.dismiss();
    try {await this.options.source.openURL(url);} catch {if (this.active) this.set({status: 'failed'});}
  };
  dispose() {this.active = false; this.generation++; this.unsubscribe?.(); this.unsubscribeSession?.(); this.flight?.abort(); this.flight = null; this.pending = null;}
}
