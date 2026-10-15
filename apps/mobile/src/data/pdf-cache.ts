import {PDF_MAX_BYTES, type PdfDescriptor} from '@slax-reader/contracts/pdf';
import {Sha256} from './pdf-sha256.ts';
import {throwIfAborted} from '../utils/abort.ts';

export type {PdfDescriptor} from '@slax-reader/contracts/pdf';
export const PDF_BLOCK_SIZE = 256 * 1024;
export const PDF_MAX_RANGE_BYTES = 1024 * 1024;
const MANIFEST_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

export interface PdfBlockStorage {
  read(path: string): Promise<Uint8Array | null>;
  writeAtomic(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  size?(path: string): Promise<number | null>;
  stageRemoval?(path: string, generation: string, signal: AbortSignal): Promise<void>;
  restoreRemoval?(path: string, generation: string): Promise<void>;
  purgeRemoval?(path: string, generation: string): Promise<void>;
}
export interface PdfCacheStatus {downloadedBytes: number; totalBytes: number; complete: boolean}
interface Manifest {version: number; blockSize: number; descriptor: PdfDescriptor; generation?: string}
interface StorageLock {writer?: Promise<void>; readers: Set<Promise<void>>}
const storageLocks = new WeakMap<PdfBlockStorage, Map<string, StorageLock>>();
const storageEpochs = new WeakMap<PdfBlockStorage, Map<string, number>>();
const storageDenials = new WeakMap<PdfBlockStorage, Set<string>>();
const storageRevisions = new WeakMap<PdfBlockStorage, Map<string, number>>();
const storageStaging = new WeakMap<PdfBlockStorage, Set<string>>();

function descriptorValue(value: unknown): PdfDescriptor {
  if (!value || typeof value !== 'object') throw new Error('Invalid PDF descriptor');
  const pdf = value as PdfDescriptor;
  if (typeof pdf.document_id !== 'string' || pdf.document_id.length !== 64 || !/^[a-f0-9]+$/.test(pdf.document_id) ||
      !Number.isSafeInteger(pdf.size) || pdf.size < 1 || pdf.size > PDF_MAX_BYTES ||
      typeof pdf.url !== 'string' || typeof pdf.filename !== 'string' || !['url', 'upload'].includes(pdf.source) ||
      !['pending', 'ready', 'empty', 'failed'].includes(pdf.text_status) ||
      (pdf.pages !== undefined && (!Number.isSafeInteger(pdf.pages) || pdf.pages < 1))) throw new Error('Invalid PDF descriptor');
  return {url: pdf.url, filename: pdf.filename, size: pdf.size, document_id: pdf.document_id,
    source: pdf.source, text_status: pdf.text_status, ...(pdf.pages === undefined ? {} : {pages: pdf.pages})};
}
function sameDocument(left: PdfDescriptor | null, right: PdfDescriptor): boolean {
  return left?.document_id === right.document_id && left.size === right.size;
}

export class PdfBlockCache {
  private storage: PdfBlockStorage;
  private guard: () => void;
  private cleanupGuard: () => void;
  private epochs = new Map<string, number>();
  private denied = new Set<string>();
  private root: string;
  private locks: Map<string, StorageLock>;
  private scans = new Map<string, Promise<PdfCacheStatus>>();
  private revisions: Map<string, number>;
  private staging: Set<string>;
  private stagingSequence = 0;

  constructor(storage: PdfBlockStorage, scope: string, guard: () => void, cleanupGuard = guard) {
    if (typeof scope !== 'string' || !scope) throw new Error('PDF cache scope is required');
    this.storage = storage;
    this.guard = guard;
    this.cleanupGuard = cleanupGuard;
    this.root = `pdf/v${MANIFEST_VERSION}/${new Sha256().update(encoder.encode(JSON.stringify(scope))).digest()}/`;
    this.locks = storageLocks.get(storage) ?? new Map();
    storageLocks.set(storage, this.locks);
    this.epochs = storageEpochs.get(storage) ?? new Map();
    storageEpochs.set(storage, this.epochs);
    this.denied = storageDenials.get(storage) ?? new Set();
    storageDenials.set(storage, this.denied);
    this.revisions = storageRevisions.get(storage) ?? new Map();
    storageRevisions.set(storage, this.revisions);
    this.staging = storageStaging.get(storage) ?? new Set();
    storageStaging.set(storage, this.staging);
  }

  metadata(key: string): Promise<PdfDescriptor | null> {
    return this.locked(key, false, async prefix => (await this.loadManifest(prefix))?.descriptor ?? null);
  }

  async setMetadata(key: string, descriptor: PdfDescriptor): Promise<void> {
    const prefix = this.prefix(key), epoch = this.epochs.get(prefix) ?? 0;
    const check = () => {this.guard(); if ((this.epochs.get(prefix) ?? 0) !== epoch) throw new Error('PDF access revoked');};
    return this.locked(key, true, async prefix => {
      check();
      const tombstones = await this.denials(prefix); check();
      const pdf = descriptorValue(descriptor);
      const previous = await this.loadManifest(prefix); check();
      if (!sameDocument(previous?.descriptor ?? null, pdf)) {await this.clear(prefix); check();}
      const generation = sameDocument(previous?.descriptor ?? null, pdf) ? previous?.generation : undefined;
      const manifest: Manifest = {version: MANIFEST_VERSION, blockSize: PDF_BLOCK_SIZE, descriptor: pdf, ...(generation ? {generation} : {})};
      await this.io(() => this.storage.writeAtomic(`${prefix}manifest.json`, encoder.encode(JSON.stringify(manifest)))); check();
      for (const path of tombstones) {await this.io(() => this.storage.remove(path)); check();}
      this.denied.delete(prefix);
      await this.prune(prefix, manifest, check);
    });
  }

  async invalidate(key: string): Promise<void> {
    this.cleanupGuard();
    const prefix = this.prefix(key), epoch = (this.epochs.get(prefix) ?? 0) + 1;
    this.epochs.set(prefix, epoch); this.denied.add(prefix);
    const tombstone = `${prefix}denials/denied-${Date.now()}-${epoch}.json`;
    let markerFailed = false, markerError: unknown;
    try {await this.storage.writeAtomic(tombstone, encoder.encode('denied'));}
    catch (error) {markerFailed = true; markerError = error;}
    finally {this.cleanupGuard();}
    try {await this.locked(key, true, prefix => this.clear(prefix, this.cleanupGuard, true), this.cleanupGuard, false);}
    catch (error) {if (markerFailed) throw new AggregateError([markerError, error], 'PDF denial persistence and cleanup failed'); throw error;}
    this.cleanupGuard();
    if (markerFailed) throw markerError;
  }

  read(key: string, descriptor: PdfDescriptor, begin: number, end: number): Promise<Uint8Array | null> {
    return this.locked(key, false, async prefix => {
      const pdf = descriptorValue(descriptor);
      if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin ||
          end > pdf.size || end - begin > PDF_MAX_RANGE_BYTES) throw new Error('Invalid PDF byte range');
      const stored = await this.loadManifest(prefix);
      this.guard();
      if (!stored || !sameDocument(stored.descriptor, pdf)) return null;
      const result = new Uint8Array(end - begin);
      for (let offset = Math.floor(begin / PDF_BLOCK_SIZE) * PDF_BLOCK_SIZE; offset < end; offset += PDF_BLOCK_SIZE) {
        const block = await this.loadBlock(prefix, stored, offset);
        this.guard();
        if (!block) return null;
        const left = Math.max(begin, offset), right = Math.min(end, offset + block.byteLength);
        result.set(block.subarray(left - offset, right - offset), left - begin);
      }
      return result;
    });
  }

  writeBlock(key: string, descriptor: PdfDescriptor, begin: number, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    return this.locked(key, true, async prefix => {
      throwIfAborted(signal);
      const pdf = descriptorValue(descriptor);
      if (!Number.isSafeInteger(begin) || begin < 0 || begin >= pdf.size || begin % PDF_BLOCK_SIZE !== 0 ||
          !(bytes instanceof Uint8Array) || bytes.byteLength !== Math.min(PDF_BLOCK_SIZE, pdf.size - begin)) throw new Error('Invalid PDF block');
      const block = new Uint8Array(bytes);
      const stored = await this.loadManifest(prefix);
      this.guard(); throwIfAborted(signal);
      if (!stored || !sameDocument(stored.descriptor, pdf)) throw new Error('PDF cache identity changed');
      if (stored.generation && await this.loadBlock(prefix, stored, begin)) {throwIfAborted(signal); return;}
      throwIfAborted(signal);
      await this.io(() => this.storage.writeAtomic(this.blockPath(prefix, stored, begin), block, signal));
      this.guard(); throwIfAborted(signal);
    });
  }

  async writeComplete(key: string, descriptor: PdfDescriptor, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void> {
    const pdf = descriptorValue(descriptor), prefix = this.prefix(key), epoch = this.epochs.get(prefix) ?? 0;
    const revision = this.revisions.get(prefix) ?? 0;
    const generation = `full-${Date.now()}-${++this.stagingSequence}-${Math.random().toString(36).slice(2)}`;
    const directory = `${prefix}${pdf.document_id}-${pdf.size}/${generation}/`;
    const current = () => {
      this.guard();
      if ((this.epochs.get(prefix) ?? 0) !== epoch || this.denied.has(prefix)) throw new Error('PDF access revoked');
      if ((this.revisions.get(prefix) ?? 0) !== revision) throw new Error('PDF cache identity changed');
    };
    const check = () => {current(); throwIfAborted(signal);};
    const integrity = (message: string) => Object.assign(new Error(message), {code: 'offline_integrity_invalid'});
    const hash = new Sha256(), buffer = new Uint8Array(PDF_BLOCK_SIZE), written: string[] = [];
    let received = 0, buffered = 0, committed = false, publishing = false;
    const flush = async () => {
      if (!buffered) return;
      await this.locked(key, true, async () => {
        check(); const path = `${directory}${received - buffered}.block`; written.push(path);
        await this.io(() => this.storage.writeAtomic(path, buffer.slice(0, buffered), signal)); check();
      });
      buffered = 0;
    };
    try {
      await this.locked(key, true, async () => {
        check(); const stored = await this.loadManifest(prefix); check();
        if (!stored || !sameDocument(stored.descriptor, pdf)) throw new Error('PDF cache identity changed');
        await this.prune(prefix, stored, check); check(); this.staging.add(directory);
      });
      for await (const chunk of chunks) {
        check();
        if (!(chunk instanceof Uint8Array) || chunk.byteLength > PDF_MAX_RANGE_BYTES || received + chunk.byteLength > pdf.size) throw integrity('Invalid complete PDF chunk');
        await hash.updateAsync(chunk, check);
        for (let offset = 0; offset < chunk.byteLength;) {
          const count = Math.min(buffer.length - buffered, chunk.byteLength - offset);
          buffer.set(chunk.subarray(offset, offset + count), buffered); buffered += count; received += count; offset += count;
          if (buffered === buffer.length) await flush();
        }
      }
      check();
      if (received !== pdf.size || hash.digest() !== pdf.document_id) throw integrity('Complete PDF checksum verification failed');
      await flush(); check();
      await this.locked(key, true, async () => {
        check(); const stored = await this.loadManifest(prefix); check();
        if (!stored || !sameDocument(stored.descriptor, pdf)) throw new Error('PDF cache identity changed');
        const manifest: Manifest = {...stored, generation};
        publishing = true;
        await this.io(() => this.storage.writeAtomic(`${prefix}manifest.json`, encoder.encode(JSON.stringify(manifest)), signal));
        committed = true; check(); await this.prune(prefix, manifest, check);
      });
    } finally {
      this.staging.delete(directory);
      if (!committed && written.length) {
        try {
          await this.locked(key, true, async () => {
            current();
            if (publishing && (await this.loadManifest(prefix))?.generation === generation) return;
            for (const path of written) {current(); await this.io(() => this.storage.remove(path));}
          });
        } catch {}
      }
    }
  }

  status(key: string): Promise<PdfCacheStatus> {
    return this.locked(key, false, async prefix => {
      const stored = await this.loadManifest(prefix);
      this.guard();
      if (!stored) return {downloadedBytes: 0, totalBytes: 0, complete: false};
      const result = await this.scan(prefix, stored);
      this.guard();
      return result;
    });
  }

  verify(key: string, descriptor: PdfDescriptor): Promise<boolean> {
    return this.locked(key, false, async prefix => {
      const pdf = descriptorValue(descriptor);
      const stored = await this.loadManifest(prefix);
      this.guard();
      if (!stored || !sameDocument(stored.descriptor, pdf)) return false;
      const result = await this.scan(prefix, stored);
      this.guard();
      return result.complete;
    });
  }

  remove(key: string, check: () => void = () => {}): Promise<void> {
    const guard = () => {this.guard(); check();};
    return this.locked(key, true, prefix => this.clear(prefix, guard), guard);
  }

  stageRemoval(key: string, generation: string, signal: AbortSignal): Promise<void> {
    return this.locked(key, true, async prefix => {
      throwIfAborted(signal);
      if (!this.storage.stageRemoval) throw new Error('Recoverable PDF removal unavailable');
      this.revisions.set(prefix, (this.revisions.get(prefix) ?? 0) + 1);
      await this.io(() => this.storage.stageRemoval!(prefix.slice(0, -1), generation, signal)); throwIfAborted(signal);
    });
  }
  restoreRemoval(key: string, generation: string): Promise<void> {
    return this.locked(key, true, async prefix => {
      if (!this.storage.restoreRemoval) throw new Error('Recoverable PDF removal unavailable');
      this.revisions.set(prefix, (this.revisions.get(prefix) ?? 0) + 1);
      await this.io(() => this.storage.restoreRemoval!(prefix.slice(0, -1), generation), this.cleanupGuard);
      const tombstones = await this.denials(prefix, this.cleanupGuard);
      if (this.denied.has(prefix) || tombstones.length) await this.clear(prefix, this.cleanupGuard, true);
    }, this.cleanupGuard, false);
  }
  async purgeRemoval(key: string, generation: string): Promise<void> {
    this.cleanupGuard();
    if (!this.storage.purgeRemoval) throw new Error('Recoverable PDF removal unavailable');
    const prefix = this.prefix(key);
    await this.io(() => this.storage.purgeRemoval!(prefix.slice(0, -1), generation), this.cleanupGuard);
  }

  bytes(key: string): Promise<number> {
    return this.locked(key, false, async prefix => {
      const stored = await this.loadManifest(prefix);
      this.guard();
      if (!stored) return 0;
      const paths = await this.blockInventory(prefix, stored);
      this.guard();
      const total = await this.measure(prefix, stored, paths);
      this.guard();
      return total;
    });
  }

  private prefix(key: string): string {
    if (typeof key !== 'string' || !key || /[^\w-]/.test(key)) throw new Error('Invalid PDF cache key');
    return `${this.root}${key}/`;
  }

  private async locked<T>(key: string, write: boolean, run: (prefix: string) => Promise<T>, guard = this.guard, fence = true): Promise<T> {
    guard();
    const prefix = this.prefix(key), epoch = this.epochs.get(prefix) ?? 0;
    const check = () => {guard(); if (fence && (this.epochs.get(prefix) ?? 0) !== epoch) throw new Error('PDF access revoked');};
    const lock = this.locks.get(prefix) ?? {readers: new Set<Promise<void>>()};
    this.locks.set(prefix, lock);
    const previous = write ? [lock.writer, ...lock.readers] : [lock.writer];
    let release!: () => void;
    const current = new Promise<void>(resolve => {release = resolve;});
    if (write) {lock.writer = current; lock.readers.clear();} else lock.readers.add(current);
    try {
      await Promise.all(previous);
      check();
      const result = await run(prefix);
      check();
      return result;
    } finally {
      release();
      if (write && lock.writer === current) lock.writer = undefined;
      lock.readers.delete(current);
      if (!lock.writer && !lock.readers.size) this.locks.delete(prefix);
    }
  }

  private async io<T>(run: () => Promise<T>, guard = this.guard): Promise<T> {
    guard();
    try {return await run();} finally {guard();}
  }

  private async denials(prefix: string, guard = this.guard): Promise<string[]> {
    const directory = `${prefix}denials/`, paths = await this.io(() => this.storage.list(directory), guard);
    return paths.filter(path => path.startsWith(directory) && /^denied-\d+-\d+\.json$/.test(path.slice(directory.length)));
  }

  private async loadManifest(prefix: string): Promise<Manifest | null> {
    if (this.denied.has(prefix) || (await this.denials(prefix)).length) return null;
    const bytes = await this.io(() => this.storage.read(`${prefix}manifest.json`));
    this.guard();
    if (!bytes) return null;
    try {
      const manifest = JSON.parse(decoder.decode(bytes)) as Manifest | null;
      if (manifest?.version !== MANIFEST_VERSION || manifest.blockSize !== PDF_BLOCK_SIZE || manifest.generation !== undefined && (typeof manifest.generation !== 'string' || !/^full-[\w-]{1,100}$/.test(manifest.generation))) return null;
      return {...manifest, descriptor: descriptorValue(manifest.descriptor)};
    } catch {return null;}
  }

  private blockDirectory(prefix: string, manifest: Manifest): string {
    const {descriptor: pdf, generation} = manifest;
    return `${prefix}${pdf.document_id}-${pdf.size}/${generation ? `${generation}/` : ''}`;
  }
  private blockPath(prefix: string, manifest: Manifest, begin: number): string {
    return `${this.blockDirectory(prefix, manifest)}${begin}.block`;
  }

  private async loadBlock(prefix: string, manifest: Manifest, begin: number): Promise<Uint8Array | null> {
    const bytes = await this.io(() => this.storage.read(this.blockPath(prefix, manifest, begin)));
    this.guard();
    return bytes?.byteLength === Math.min(PDF_BLOCK_SIZE, manifest.descriptor.size - begin) ? bytes : null;
  }

  private async blockInventory(prefix: string, manifest: Manifest): Promise<Set<string>> {
    const paths = await this.io(() => this.storage.list(this.blockDirectory(prefix, manifest)));
    this.guard();
    return new Set(paths);
  }

  private async yieldTurn(): Promise<void> {
    this.guard();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    this.guard();
  }

  private async measure(prefix: string, manifest: Manifest, paths: Set<string>): Promise<number> {
    const pdf = manifest.descriptor;
    let total = 0;
    for (let begin = 0; begin < pdf.size; begin += PDF_BLOCK_SIZE) {
      if (begin % (PDF_BLOCK_SIZE * 8) === 0) {await this.yieldTurn(); this.guard();}
      const path = this.blockPath(prefix, manifest, begin);
      if (!paths.has(path)) continue;
      const size = this.storage.size
        ? await this.io(() => this.storage.size!(path))
        : (await this.loadBlock(prefix, manifest, begin))?.byteLength;
      this.guard();
      if (size === Math.min(PDF_BLOCK_SIZE, pdf.size - begin)) total += size;
    }
    return total;
  }

  private async scan(prefix: string, manifest: Manifest): Promise<PdfCacheStatus> {
    this.guard();
    const key = this.blockDirectory(prefix, manifest);
    let pending = this.scans.get(key);
    if (!pending) {
      pending = this.scanBlocks(prefix, manifest);
      this.scans.set(key, pending);
    }
    try {
      const result = await pending;
      this.guard();
      return {...result};
    } finally {
      if (this.scans.get(key) === pending) this.scans.delete(key);
      this.guard();
    }
  }

  private async scanBlocks(prefix: string, manifest: Manifest): Promise<PdfCacheStatus> {
    const pdf = manifest.descriptor, paths = await this.blockInventory(prefix, manifest);
    this.guard();
    let allPresent = true;
    for (let begin = 0; begin < pdf.size; begin += PDF_BLOCK_SIZE) {
      if (!paths.has(this.blockPath(prefix, manifest, begin))) {allPresent = false; break;}
    }
    if (!allPresent || this.storage.size) {
      const downloadedBytes = await this.measure(prefix, manifest, paths);
      this.guard();
      if (downloadedBytes !== pdf.size) return {downloadedBytes, totalBytes: pdf.size, complete: false};
    }
    const hash = new Sha256();
    let downloadedBytes = 0;
    for (let begin = 0; begin < pdf.size; begin += PDF_BLOCK_SIZE) {
      const block = await this.loadBlock(prefix, manifest, begin);
      this.guard();
      if (block) {
        downloadedBytes += block.byteLength;
        await hash.updateAsync(block, this.guard);
        this.guard();
      } else {await this.yieldTurn(); this.guard();}
    }
    return {downloadedBytes, totalBytes: pdf.size, complete: downloadedBytes === pdf.size && hash.digest() === pdf.document_id};
  }

  private async prune(prefix: string, manifest: Manifest, check = this.guard): Promise<void> {
    try {
      check();
      const current = this.blockDirectory(prefix, manifest), paths = await this.io(() => this.storage.list(prefix));
      for (const path of paths) {
        check();
        if (!path.startsWith(prefix) || !/^[a-f0-9]{64}-\d+\/(full-[\w-]{1,100}\/)?\d+\.block$/.test(path.slice(prefix.length))) continue;
        const directory = path.slice(0, path.lastIndexOf('/') + 1);
        if (directory === current || this.staging.has(directory)) continue;
        await this.io(() => this.storage.remove(path));
      }
    } catch {check();}
  }

  private async clear(prefix: string, guard = this.guard, bestEffort = false): Promise<void> {
    guard(); this.revisions.set(prefix, (this.revisions.get(prefix) ?? 0) + 1);
    const errors: unknown[] = [];
    const remove = async (path: string) => {
      try {await this.io(() => this.storage.remove(path), guard);}
      catch (error) {guard(); if (!bestEffort) throw error; errors.push(error);}
    };
    await remove(`${prefix}manifest.json`);
    const paths = await this.io(() => this.storage.list(prefix), guard);
    for (const path of new Set(paths)) {
      if (!path.startsWith(prefix)) continue;
      const suffix = path.slice(prefix.length);
      if (/^denials\/denied-\d+-\d+\.json$/.test(suffix)) continue;
      if (!suffix || !suffix.split('/').every(part => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..')) continue;
      await remove(path);
    }
    if (errors.length) throw new AggregateError(errors, 'PDF cleanup failed');
  }
}
