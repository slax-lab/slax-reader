import {SessionChangedError} from '../domain/session.ts';
import type {SessionAuthority, SessionRequestScope} from '../domain/session.ts';
import type {PreferenceStore} from '../data/preferences.ts';
import type {CheckPurchase} from '../data/api.ts';

export interface SignedOffer {offerId: string; keyID: string; nonce: string; signature: string; timestamp: number}
export interface PurchaseCommand {productId: string; orderId: string; offer?: SignedOffer}
export interface StorePurchase {
  productId: string; transactionId?: string|null; appAccountToken?: string|null; purchaseToken?: string|null;
  purchaseState: string; revocationDateIOS?: number|null;
}
export interface StorePort {
  start(onPurchase: (purchase: StorePurchase) => void, onError: (error: {code?: string; message: string}) => void): Promise<void>;
  products(ids: string[]): Promise<void>;
  purchase(command: PurchaseCommand): Promise<void>;
  finish(purchase: StorePurchase): Promise<void>;
  restore(): Promise<StorePurchase[]>;
  pending(): Promise<StorePurchase[]>;
  entitlements(): Promise<StorePurchase[]>;
  stop(): Promise<void>;
}
export type PaymentState = {status: 'idle'|'loading'|'purchasing'|'checking'|'success'|'cancelled'|'pending'} | {status: 'error'; message: string};
interface PaymentScope {request?: SessionRequestScope; generation: number}
class PaymentCancelledError extends Error {}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parsePurchaseMessage(raw: string): PurchaseCommand|null {
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || (value.type !== 'purchase' && value.type !== 'purchaseWithOffer')) return null;
  if (typeof value.productId !== 'string' || !value.productId || typeof value.orderId !== 'string' || !UUID.test(value.orderId)) throw new Error('Invalid purchase product or order UUID');
  const command: PurchaseCommand = {productId: value.productId, orderId: value.orderId.toLowerCase()};
  if (value.type === 'purchaseWithOffer') {
    if (!['offerId','keyID','nonce','signature'].every(key => typeof value[key] === 'string' && value[key]) || !UUID.test(String(value.nonce)) || !Number.isSafeInteger(value.timestamp) || Number(value.timestamp) <= 0) throw new Error('Invalid signed promotional offer');
    command.offer = {offerId: String(value.offerId), keyID: String(value.keyID), nonce: String(value.nonce), signature: String(value.signature), timestamp: Number(value.timestamp)};
  }
  return command;
}

/** Store callbacks are serialized, account-bound, and finished only after backend validation. */
export class PaymentController {
  private state: PaymentState = {status: 'idle'};
  private listeners = new Set<() => void>();
  private serial: Promise<unknown> = Promise.resolve();
  private products = new Set<string>();
  private seen = new Set<string>();
  private started = false;
  private generation = 0;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private purchasedIds = new Set<string>();
  private purchaseReservation: PaymentScope | null = null;
  private purchaseErrorScope: PaymentScope | null = null;
  private port: StorePort;
  private sessions: SessionAuthority;
  private preferences: PreferenceStore;
  private verify: (params: CheckPurchase) => Promise<{ok: boolean}>;
  constructor(port: StorePort, sessions: SessionAuthority, preferences: PreferenceStore, verify: (params: CheckPurchase) => Promise<{ok: boolean}>) {
    this.port = port; this.sessions = sessions; this.preferences = preferences; this.verify = verify;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(state: PaymentState) { this.state = state; this.listeners.forEach(listener => listener()); }
  private captureScope(): PaymentScope {return {generation: this.generation, request: this.sessions.captureRequestScope?.()};}
  private assertScope(scope: PaymentScope, requireStarted = true) {
    if (scope.generation !== this.generation || requireStarted && !this.started) throw new PaymentCancelledError();
    scope.request?.assertCurrent();
  }
  private cancelled(error: unknown, scope: PaymentScope, requireStarted = true) {
    if (error instanceof SessionChangedError || error instanceof PaymentCancelledError) return true;
    try {this.assertScope(scope, requireStarted);} catch {return true;}
    return false;
  }
  private async session(scope: PaymentScope) {
    this.assertScope(scope);
    const value = await (scope.request ? scope.request.getSession() : this.sessions.getSession());
    this.assertScope(scope); return value;
  }
  private storeError(error: unknown) {
    const value = error && typeof error === 'object' ? error as {code?: string; message?: string} : {};
    const next: PaymentState = value.code === 'user-cancelled' ? {status: 'cancelled'} : value.code === 'deferred-payment' ? {status: 'pending'} : {status: 'error', message: value.message ?? 'Purchase failed'};
    if (next.status === this.state.status && (next.status !== 'error' || this.state.status === 'error' && next.message === this.state.message)) return;
    this.emit(next);
  }
  reset = () => { this.emit({status: 'idle'}); };
  async loadProducts(load: () => Promise<string[]>, isCurrent = () => true): Promise<void> {
    const scope = this.captureScope();
    try {
      this.assertScope(scope, false);
      if (!isCurrent()) return;
      this.emit({status: 'loading'});
      const ids = await load();
      this.assertScope(scope, false);
      if (isCurrent()) await this.start(ids);
    } catch (error) {
      if (error instanceof SessionChangedError || error instanceof PaymentCancelledError || !isCurrent()) return;
      try {this.assertScope(scope, false);} catch {return;}
      this.emit({status: 'error', message: 'Unable to load subscription products'});
    }
  }
  start(ids: string[]): Promise<void> {
    const scope = this.captureScope();
    const next = this.lifecycle.then(() => this.startInternal(ids, scope), () => this.startInternal(ids, scope));
    this.lifecycle = next.catch(() => undefined);
    return next;
  }
  private async startInternal(ids: string[], scope: PaymentScope) {
    try {
      this.assertScope(scope, false);
      if (!this.started) {
        this.started = true;
        try {await this.port.start(purchase => {
          // Each event captures the current epoch before entering the serialized queue.
          if (this.started && scope.generation === this.generation) this.enqueue(purchase);
        }, error => {
          const owner = this.purchaseErrorScope ?? scope;
          try {this.assertScope(owner); this.storeError(error);} catch { /* A late native error cannot affect the next account. */ }
        });} catch (error) {this.started = false; throw error;}
        this.assertScope(scope);
      }
      this.emit({status: 'loading'});
      this.assertScope(scope); await this.port.products(ids); this.assertScope(scope);
      this.products = new Set(ids);
      await this.refreshEntitlements(scope); this.assertScope(scope);
      const pending = await this.port.pending(); this.assertScope(scope);
      for (const purchase of pending) this.enqueue(purchase, scope);
      if (this.state.status === 'loading') this.emit({status: 'idle'});
    } catch (error) {if (!this.cancelled(error, scope, false)) this.emit({status: 'error', message: error instanceof Error ? error.message : 'Unable to load products'});}
  }
  private enqueue(purchase: StorePurchase, scope = this.captureScope()) {
    this.serial = this.serial.then(() => this.receive(purchase, scope), () => this.receive(purchase, scope)).catch(error => {
      if (!this.cancelled(error, scope)) this.emit({status: 'error', message: error instanceof Error ? error.message : 'Transaction verification failed'});
    });
  }
  isPurchased(productId: string) { return this.purchasedIds.has(productId); }
  getPurchasedIds() { return [...this.purchasedIds]; }
  async refreshEntitlements(scope = this.captureScope()) {
    this.assertScope(scope); const active = await this.port.entitlements(); this.assertScope(scope);
    this.purchasedIds = new Set(active.filter(item => !item.revocationDateIOS && item.purchaseState === 'purchased').map(item => item.productId));
  }
  async purchase(command: PurchaseCommand) {
    const scope = this.captureScope();
    if (this.purchaseReservation) {
      try {this.assertScope(this.purchaseReservation); return;} catch {this.purchaseReservation = null;}
    }
    if (['purchasing','checking','pending'].includes(this.state.status)) return;
    if (!this.products.has(command.productId) || !UUID.test(command.orderId)) throw new Error('Product or order is unavailable');
    try {
      this.assertScope(scope); this.purchaseReservation = scope; this.purchaseErrorScope = scope;
      this.emit({status: 'purchasing'});
      const session = await this.session(scope);
      if (!session) throw new Error('Sign in before purchasing');
      this.assertScope(scope);
      await this.preferences.update(values => {this.assertScope(scope); values[`iap_order:${command.orderId.toLowerCase()}`] = JSON.stringify({userId: session.userId, productId: command.productId});});
      this.assertScope(scope);
      if ((await this.session(scope))?.userId !== session.userId) throw new PaymentCancelledError();
      this.assertScope(scope); await this.port.purchase(command); this.assertScope(scope);
    } catch (error) {
      if (!this.cancelled(error, scope)) this.storeError(error);
    } finally {if (this.purchaseReservation === scope) this.purchaseReservation = null;}
  }
  private async receive(purchase: StorePurchase, scope: PaymentScope) {
    this.assertScope(scope);
    const session = await this.session(scope);
    if (!session) return;
    const transaction = purchase.transactionId;
    const order = purchase.appAccountToken?.toLowerCase();
    const saved = order ? (await this.preferences.read())[`iap_order:${order}`] : undefined;
    this.assertScope(scope);
    if (typeof saved === 'string') {
      let owner: {userId: string; productId: string};
      try { owner = JSON.parse(saved); } catch { this.emit({status: 'error', message: 'Saved purchase ownership is invalid'}); return; }
      if (!owner || typeof owner.userId !== 'string' || typeof owner.productId !== 'string') { this.emit({status: 'error', message: 'Saved purchase ownership is invalid'}); return; }
      if (owner.userId !== session.userId || owner.productId !== purchase.productId) return;
    }
    if (purchase.purchaseState === 'pending') {this.emit({status: 'pending'}); return;}
    if (purchase.revocationDateIOS) {this.purchasedIds.delete(purchase.productId); await this.refreshEntitlements(scope); this.assertScope(scope); return;}
    if (purchase.purchaseState !== 'purchased') return;
    const jws = purchase.purchaseToken;
    if (!transaction || !order || !UUID.test(order) || !jws) {this.emit({status: 'error', message: 'Missing transaction ID, order UUID, or signed transaction'}); return;}
    if (this.seen.has(transaction)) return;
    this.emit({status: 'checking'});
    try {
      this.assertScope(scope);
      const result = await this.verify({product_id: purchase.productId, order_id: order, jws_representation: jws, platform: 'ios'});
      this.assertScope(scope);
      if ((await this.session(scope))?.userId !== session.userId) throw new PaymentCancelledError();
      if (!result.ok) throw new Error('Transaction verification failed');
      this.assertScope(scope); await this.port.finish(purchase); this.assertScope(scope);
      this.seen.add(transaction);
      await this.refreshEntitlements(scope); this.assertScope(scope);
      await this.preferences.update(values => {this.assertScope(scope); delete values[`iap_order:${order}`];});
      this.assertScope(scope);
      this.emit({status: 'success'});
    } catch (error) {if (!this.cancelled(error, scope)) this.emit({status: 'error', message: error instanceof Error ? error.message : 'Transaction verification failed'});}
  }
  async restore() {
    const scope = this.captureScope();
    try {
      this.assertScope(scope); const purchases = await this.port.restore(); this.assertScope(scope);
      for (const purchase of purchases) this.enqueue(purchase, scope);
      await this.serial; this.assertScope(scope); await this.refreshEntitlements(scope); this.assertScope(scope);
    } catch (error) {if (!this.cancelled(error, scope)) throw error;}
  }
  stop(): Promise<void> {
    this.generation++;
    const next = this.lifecycle.then(async () => {this.started = false; this.purchaseReservation = null; this.purchaseErrorScope = null; await this.serial.catch(() => undefined); await this.port.stop(); this.products.clear(); this.seen.clear(); this.purchasedIds.clear(); this.emit({status: 'idle'});});
    this.lifecycle = next.catch(() => undefined);
    return next;
  }
}
