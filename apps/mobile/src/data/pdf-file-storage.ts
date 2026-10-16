import type {PdfBlockStorage} from './pdf-cache.ts';
import {Sha256} from './pdf-sha256.ts';
import {NativeFileStore} from './native-file-store.ts';

export class PdfFileStorage implements PdfBlockStorage {
  private readonly files: NativeFileStore;
  constructor(directory: string, guard: () => void = () => {}, owner: string | null = null) {this.files = new NativeFileStore(directory, owner, guard);}
  private path(path: string): string {
    if (!(path === 'pdf' || path.startsWith('pdf/')) || !path.split('/').every(part => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..')) throw new Error('Invalid PDF cache path');
    return path;
  }
  size(path: string): Promise<number | null> {return this.files.size(this.path(path), true);}
  async read(path: string): Promise<Uint8Array | null> {
    const bytes = await this.files.readBytes(this.path(path), true);
    if (bytes && bytes.byteLength > 1024 * 1024) throw new Error('PDF cache block exceeds limit');
    return bytes;
  }
  async writeAtomic(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    if (bytes.byteLength > 1024 * 1024) throw new Error('PDF cache block exceeds limit');
    if (signal) await this.files.writeBlock(this.path(path), bytes, signal);
    else await this.files.writeBytes(this.path(path), bytes, true);
  }
  remove(path: string): Promise<void> {return this.files.remove(this.path(path), true);}
  list(prefix: string): Promise<string[]> {return this.files.list(this.path(prefix.replace(/\/$/, '')), true);}
  clearScope(scope: string): Promise<void> {
    const hash = new Sha256().update(new TextEncoder().encode(JSON.stringify(scope))).digest();
    return this.files.remove(this.path(`pdf/v1/${hash}`));
  }
  stageRemoval(path: string, generation: string, signal: AbortSignal) {return this.files.stageRemoval(this.path(path), generation, signal);}
  restoreRemoval(path: string, generation: string) {return this.files.restoreRemoval(this.path(path), generation);}
  purgeRemoval(path: string, generation: string) {return this.files.purgeRemoval(this.path(path), generation);}
  clear(): Promise<void> {return this.files.remove('pdf');}
}
