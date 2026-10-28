import {requireNativeModule} from 'expo';
import {throwIfAborted} from '../utils/abort.ts';

export interface NativeFileStorage {
  beginWrite(owner: string | null): string;
  endWrite(owner: string | null, id: string): void;
  writeImage(directory: string, owner: string | null, id: string, path: string, bytes: Uint8Array): Promise<string>;
  readText(directory: string, owner: string | null, path: string): Promise<string | null>;
  writeText(directory: string, owner: string | null, path: string, text: string): Promise<string>;
  size(directory: string, owner: string | null, path: string): Promise<number | null>;
  measure(directory: string, owner: string | null, path: string): Promise<number>;
  remove(directory: string, owner: string | null, path: string): Promise<unknown>;
}

export class NativeFileStore {
  private readonly directory: string;
  private readonly owner: string | null;
  private readonly guard: () => void;
  constructor(directory: string, owner: string | null, guard: () => void) {this.directory = directory; this.owner = owner; this.guard = guard;}
  private async call<T>(work: (native: NativeFileStorage) => Promise<T>): Promise<T> {
    this.guard();
    try {const value = await work(requireNativeModule<NativeFileStorage>('SlaxStorage')); this.guard(); return value;}
    catch (error) {this.guard(); throw error;}
  }
  readText(path: string) {return this.call(native => native.readText(this.directory, this.owner, path));}
  writeText(path: string, text: string) {return this.call(native => native.writeText(this.directory, this.owner, path, text));}
  writeImage(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {return this.cancellableWrite((native, id) => native.writeImage(this.directory, this.owner, id, path, bytes), signal);}
  private async cancellableWrite<T>(write: (native: NativeFileStorage, id: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.guard(); throwIfAborted(signal);
    const native = requireNativeModule<NativeFileStorage>('SlaxStorage');
    const id = native.beginWrite(this.owner);
    const cancel = () => native.endWrite(this.owner, id);
    signal?.addEventListener('abort', cancel, {once: true});
    try {
      throwIfAborted(signal); this.guard();
      const uri = await write(native, id);
      this.guard(); throwIfAborted(signal); return uri;
    } catch (error) {this.guard(); throwIfAborted(signal); throw error;}
    finally {signal?.removeEventListener('abort', cancel); cancel();}
  }
  size(path: string) {return this.call(native => native.size(this.directory, this.owner, path));}
  measure(path: string) {return this.call(native => native.measure(this.directory, this.owner, path));}
  async remove(path: string): Promise<void> {await this.call(native => native.remove(this.directory, this.owner, path));}
}
