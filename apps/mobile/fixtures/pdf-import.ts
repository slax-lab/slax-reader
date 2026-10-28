import {throwIfAborted} from '../src/utils/abort.ts';
import type {FixturePdf} from './pdf.ts';

export interface FixturePdfImportState {
  acceptedUploads: number; rejectedUploads: number; matchedBytes: number;
  synchronization: 'waiting-upload' | 'pending' | 'published' | 'cancelled' | 'failed';
}
export function createFixturePdfImport(options: {
  document: FixturePdf; bookmarkId: string; delayMs: number;
  active(): boolean; foreground(): Promise<void>; publish(): Promise<void>;
  record(state: FixturePdfImportState): void;
}) {
  const state: FixturePdfImportState = {acceptedUploads: 0, rejectedUploads: 0, matchedBytes: 0, synchronization: 'waiting-upload'};
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
  const record = () => options.record({...state});
  const current = () => {if (disposed || !options.active()) throw Object.assign(new Error('Fixture import scope inactive'), {name: 'AbortError'});};
  const publish = async () => {
    try {
      await options.foreground(); current(); await options.publish(); current();
      state.synchronization = 'published'; record();
    } catch {
      if (disposed) return;
      state.synchronization = options.active() ? 'failed' : 'cancelled'; record();
    }
  };
  return {
    async accept(body: unknown, signal?: AbortSignal | null) {
      current(); throwIfAborted(signal);
      const file = body as {size?: unknown; arrayBuffer?: () => Promise<ArrayBuffer>} | null;
      if (!file || file.size !== options.document.descriptor.size || typeof file.arrayBuffer !== 'function') {
        state.rejectedUploads++; record(); throw new Error('Only the seeded synthetic PDF is accepted');
      }
      const bytes = new Uint8Array(await file.arrayBuffer()); current(); throwIfAborted(signal);
      if (bytes.length !== options.document.descriptor.size || bytes.some((byte, index) => byte !== options.document.bytes[index])) {
        state.rejectedUploads++; record(); throw new Error('Only the seeded synthetic PDF is accepted');
      }
      state.acceptedUploads++; state.matchedBytes = bytes.length;
      if (state.synchronization !== 'published' && state.synchronization !== 'pending') {
        state.synchronization = 'pending'; timer = setTimeout(() => {timer = undefined; void publish();}, options.delayMs);
      }
      record(); return {bookmark_uid: options.bookmarkId, bookmark_id: options.bookmarkId};
    },
    dispose() {disposed = true; if (timer !== undefined) clearTimeout(timer); state.synchronization = 'cancelled';},
  };
}
