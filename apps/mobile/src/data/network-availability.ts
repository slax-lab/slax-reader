export type NetworkObservation = {isConnected?: boolean; isInternetReachable?: boolean};
export type NetworkAvailabilityState = 'unknown' | 'online' | 'offline';
export interface NetworkAvailabilitySource {
  read(): Promise<NetworkObservation>;
  subscribe(listener: (state: NetworkObservation) => void): () => void;
}

export class NetworkAvailability {
  private readonly source: NetworkAvailabilitySource;
  private readonly changed: (state: NetworkAvailabilityState) => void;
  private state: NetworkAvailabilityState = 'unknown';
  private generation = 0;
  private revision = 0;
  private unsubscribe?: () => void;
  private started = false;

  constructor(source: NetworkAvailabilitySource, changed: (state: NetworkAvailabilityState) => void) {this.source = source; this.changed = changed;}
  getSnapshot() {return this.state;}

  private accept(value: NetworkObservation) {
    const state = value.isConnected === false || value.isInternetReachable === false ? 'offline' : value.isConnected === true ? 'online' : 'unknown';
    if (state === 'unknown' || state === this.state) return;
    this.state = state; this.changed(state);
  }

  start() {
    if (this.started) return;
    this.started = true; const generation = ++this.generation;
    try {this.unsubscribe = this.source.subscribe(value => {if (this.started && generation === this.generation) {this.revision++; this.accept(value);}});} catch {}
    this.refresh();
  }

  refresh() {
    if (!this.started) return;
    const generation = this.generation, revision = ++this.revision;
    void Promise.resolve().then(() => this.source.read()).then(value => {
      if (this.started && generation === this.generation && revision === this.revision) this.accept(value);
    }).catch(() => undefined);
  }

  stop() {this.started = false; this.generation++; this.unsubscribe?.(); this.unsubscribe = undefined; this.state = 'unknown';}
}
