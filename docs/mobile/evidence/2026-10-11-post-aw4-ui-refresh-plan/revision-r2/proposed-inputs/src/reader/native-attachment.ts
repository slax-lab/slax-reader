import type {ReaderNativeAdapter, ReaderNativeContext} from './native.ts';

/** Late native attach completions cannot resubscribe a released or replacement document. */
export class ReaderNativeAttachment {
  private adapter: ReaderNativeAdapter;
  private onTouch: (screenYPoints: number) => void;
  private onTag: (tag: number | null) => void;
  private generation = 0;
  private closed = false;
  private tag: number | null = null;
  private unsubscribe: (() => void) | null = null;
  constructor(adapter: ReaderNativeAdapter, onTouch: (screenYPoints: number) => void, onTag: (tag: number | null) => void) {
    this.adapter = adapter; this.onTouch = onTouch; this.onTag = onTag;
  }
  private async release(): Promise<void> {
    const tag = this.tag; this.tag = null; this.onTag(null);
    try {this.unsubscribe?.();} finally {this.unsubscribe = null; if (tag !== null) await this.adapter.detach(tag);}
  }
  async attach(tag: number, context: ReaderNativeContext): Promise<void> {
    if (this.closed || tag === this.tag) return;
    const generation = ++this.generation;
    await this.release();
    if (this.closed || generation !== this.generation) return;
    this.tag = tag; this.onTag(tag);
    await this.adapter.attach(tag, context);
    if (this.closed || generation !== this.generation) {
      await this.adapter.detach(tag);
      return;
    }
    this.unsubscribe = this.adapter.subscribeTouch(tag, this.onTouch);
  }
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true; ++this.generation;
    await this.release();
  }
}
