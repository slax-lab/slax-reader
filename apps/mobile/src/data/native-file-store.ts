import {requireNativeModule} from 'expo-modules-core';
import {throwIfAborted} from '../utils/abort.ts';
import type {ResourceFingerprint} from './resource-fingerprint.ts';

export interface NativeFileStorage {
  beginWrite(owner: string | null): string;
  endWrite(owner: string | null, id: string): void;
  writeImage(directory: string, owner: string | null, id: string, path: string, bytes: Uint8Array): Promise<string>;
  writeBlock(directory: string, owner: string | null, id: string, path: string, bytes: Uint8Array): Promise<string>;
  readBytes(directory: string, owner: string | null, path: string, versioned: boolean): Promise<Uint8Array | null>;
  readText(directory: string, owner: string | null, path: string): Promise<string | null>;
  writeBytes(directory: string, owner: string | null, path: string, bytes: Uint8Array, versioned: boolean): Promise<string>;
  writeText(directory: string, owner: string | null, path: string, text: string): Promise<string>;
  writeArticle(directory: string, owner: string | null, id: string, path: string, text: string): Promise<string>;
  textFingerprint(directory: string, owner: string | null, text: string): Promise<ResourceFingerprint>;
  fingerprint(directory: string, owner: string | null, path: string): Promise<ResourceFingerprint | null>;
  size(directory: string, owner: string | null, path: string, versioned: boolean): Promise<number | null>;
  list(directory: string, owner: string | null, path: string, versioned: boolean): Promise<string[]>;
  measure(directory: string, owner: string | null, path: string): Promise<number>;
  remove(directory: string, owner: string | null, path: string, versioned: boolean): Promise<void>;
  stageRemoval(directory: string, owner: string | null, id: string, path: string, generation: string): Promise<void>;
  restoreRemoval(directory: string, owner: string | null, path: string, generation: string): Promise<void>;
  purgeRemoval(directory: string, owner: string | null, path: string, generation: string): Promise<void>;
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
  readBytes(path: string, versioned = false) {return this.call(native => native.readBytes(this.directory, this.owner, path, versioned));}
  readText(path: string) {return this.call(native => native.readText(this.directory, this.owner, path));}
  writeBytes(path: string, bytes: Uint8Array, versioned = false) {return this.call(native => native.writeBytes(this.directory, this.owner, path, bytes, versioned));}
  writeText(path: string, text: string) {return this.call(native => native.writeText(this.directory, this.owner, path, text));}
  fingerprint(path: string) {return this.call(native => native.fingerprint(this.directory, this.owner, path));}
  textFingerprint(text: string) {return this.call(native => native.textFingerprint(this.directory, this.owner, text));}
  writeImage(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {return this.cancellableWrite((native, id) => native.writeImage(this.directory, this.owner, id, path, bytes), signal);}
  writeBlock(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {return this.cancellableWrite((native, id) => native.writeBlock(this.directory, this.owner, id, path, bytes), signal);}
  writeArticle(path: string, text: string, signal?: AbortSignal): Promise<string> {return this.cancellableWrite((native, id) => native.writeArticle(this.directory, this.owner, id, path, text), signal);}
  stageRemoval(path: string, generation: string, signal?: AbortSignal): Promise<void> {return this.cancellableWrite((native, id) => native.stageRemoval(this.directory, this.owner, id, path, generation), signal);}
  restoreRemoval(path: string, generation: string) {return this.call(native => native.restoreRemoval(this.directory, this.owner, path, generation));}
  purgeRemoval(path: string, generation: string) {return this.call(native => native.purgeRemoval(this.directory, this.owner, path, generation));}
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
  size(path: string, versioned = false) {return this.call(native => native.size(this.directory, this.owner, path, versioned));}
  list(path: string, versioned = false) {return this.call(native => native.list(this.directory, this.owner, path, versioned));}
  measure(path: string) {return this.call(native => native.measure(this.directory, this.owner, path));}
  remove(path: string, versioned = false) {return this.call(native => native.remove(this.directory, this.owner, path, versioned));}
}
