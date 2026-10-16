export type AnalyticsValue = string | number | boolean;
export type AnalyticsParams = Record<string, AnalyticsValue>;
export interface ClientEvent { event_name: string; occurred_at: string; properties: Record<string, string> }
export interface FirebaseSink {
  logEvent(name: string, params: AnalyticsParams): Promise<void> | void;
  setUserId(userId: string | null): Promise<void> | void;
  setUserProperty(name: string, value: string | null): Promise<void> | void;
  setCrashlyticsUserId(userId: string | null): Promise<void> | void;
  recordError?(error: Error): Promise<void> | void;
}
export interface MobileTelemetryOptions {
  preferences: {deviceId(generate: () => string): Promise<string>};
  api: {sendClientEvents(deviceId: string, events: ClientEvent[]): Promise<void>};
  platform: 'ios' | 'android';
  /** Preserve the source VERSION_NAME (VERSION_CODE) string in both collectors. */
  version: string;
  locale(): string;
  generateIdentifier(): string;
  /** Bind an event before asynchronous device-ID lookup can cross a session change. */
  captureRequestScope?(): SessionRequestScope;
  firebase?: FirebaseSink;
  now?: () => Date;
}
export interface TelemetryRouteParams {bookmarkId?: string; rssEntryId?: string; openedFrom?: string}

/** Two independent, best-effort collectors matching FirstPartyEventReporter and EventBuilder. */
export class MobileTelemetry {
  private pending = new Set<Promise<void>>();
  readonly options: MobileTelemetryOptions;
  constructor(options: MobileTelemetryOptions) {this.options = options;}
  private enqueue(work: () => Promise<void> | void): void {
    const pending = Promise.resolve().then(work).catch(() => undefined);
    this.pending.add(pending);
    void pending.then(() => this.pending.delete(pending));
  }
  track(eventName: string, properties: Record<string, string> = {}): void {
    if (!eventName.trim()) return;
    const scope = this.options.captureRequestScope?.();
    const event: ClientEvent = {
      event_name: eventName, occurred_at: (this.options.now?.() ?? new Date()).toISOString(),
      properties: {platform: this.options.platform, locale: this.options.locale(), client_version: this.options.version, ...properties},
    };
    this.enqueue(async () => {
      scope?.assertCurrent();
      const deviceId = await this.options.preferences.deviceId(this.options.generateIdentifier);
      scope?.assertCurrent();
      await this.options.api.sendClientEvents(deviceId, [event]);
    });
  }
  firebase(category: string, action: string, params: AnalyticsParams = {}, subAction?: string): void {
    const name = `${category}_${action}${subAction === undefined ? '' : `_${subAction}`}`;
    const values = {...params, platform: 'app', version: this.options.version, platform_type: this.options.platform};
    this.enqueue(() => this.options.firebase?.logEvent(name, values));
  }
  identify(userId: string | null): void {
    // Keep the two native SDK calls independent: an unavailable SDK must not block its peer.
    this.enqueue(() => this.options.firebase?.setUserId(userId));
    this.enqueue(() => this.options.firebase?.setCrashlyticsUserId(userId));
  }
  userProperty(name: string, value: string | null): void {this.enqueue(() => this.options.firebase?.setUserProperty(name, value));}
  recordError(error: Error): void {this.enqueue(() => this.options.firebase?.recordError?.(error));}
  element(elementId: string, screenName: string): void {this.track('element_clicked', {element_id: elementId, screen_name: screenName});}
  /** Invoke once for each newly mounted stack entry; returning to an existing entry is not a new view. */
  screen(routeName: string, params: TelemetryRouteParams = {}): void {
    switch (routeName) {
      case 'Login': this.firebase('user', 'view', {}, 'login'); this.track('screen_viewed', {screen_name: 'signup'}); break;
      // Inbox reports first-party views with list_mode whenever its selected mode changes.
      case 'Library': this.firebase('bookmark_list', 'view'); break;
      case 'Reader':
        if (params.rssEntryId) return;
        this.firebase('bookmark', 'view', {bookmark_uuid: params.bookmarkId ?? '', mode: 'snapshot'});
        this.track('screen_viewed', {screen_name: 'detail'});
        this.track('bookmark_opened', {bookmark_id: params.bookmarkId ?? '', opened_from: params.openedFrom ?? 'direct'});
        break;
      case 'Settings': this.firebase('setting', 'view'); this.track('screen_viewed', {screen_name: 'settings'}); break;
      case 'About': this.firebase('about', 'view'); this.track('screen_viewed', {screen_name: 'about'}); break;
      case 'DeleteAccount': this.firebase('user', 'view', {}, 'delete_account'); break;
      case 'Subscription': this.firebase('subscription', 'view'); this.track('screen_viewed', {screen_name: 'subscription'}); break;
      case 'Feedback': this.firebase('feedback', 'view'); this.track('screen_viewed', {screen_name: 'feedback'}); break;
    }
  }
  /** Observation helper for tests and graceful runtime shutdown, never awaited by UI handlers. */
  async flush(): Promise<void> {while (this.pending.size) await Promise.all([...this.pending]);}
}
export const createMobileTelemetry = (options: MobileTelemetryOptions) => new MobileTelemetry(options);
import type {SessionRequestScope} from '../domain/session.ts';
