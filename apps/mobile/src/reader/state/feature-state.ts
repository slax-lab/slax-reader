export class FeatureState<T> {
  private value: T;
  private listeners = new Set<() => void>();
  private visible = true;
  private changed = false;
  constructor(initial: T) {this.value = initial;}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  set = (value: T | ((previous: T) => T)) => {
    const next = typeof value === 'function' ? (value as (previous: T) => T)(this.value) : value;
    if (Object.is(next, this.value)) return;
    this.value = next; this.changed = true;
    if (this.visible) this.publish();
  };
  setVisible(visible: boolean) {this.visible = visible; if (visible && this.changed) this.publish();}
  private publish() {this.changed = false; for (const listener of this.listeners) listener();}
}
export interface ReaderAiState {content: string; takeaways: string[]; busy: boolean; pending: boolean; error: string | null}
