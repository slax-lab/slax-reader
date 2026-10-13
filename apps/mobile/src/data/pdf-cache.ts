import {PDF_MAX_BYTES, type PdfDescriptor} from '@slax-reader/contracts/pdf';
import {Sha256} from './pdf-sha256.ts';

export type {PdfDescriptor} from '@slax-reader/contracts/pdf';
export const PDF_BLOCK_SIZE = 256 * 1024;
export const PDF_MAX_RANGE_BYTES = 1024 * 1024;
const MANIFEST_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

export interface PdfBlockStorage {
  read(path: string): Promise<Uint8Array | null>;
  writeAtomic(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  size?(path: string): Promise<number | null>;
}
export interface PdfCacheStatus {downloadedBytes: number; totalBytes: number; complete: boolean}
interface Manifest {version: number; blockSize: number; descriptor: PdfDescriptor}
interface StorageLock {writer?: Promise<void>; readers: Set<Promise<void>>}
const storageLocks = new WeakMap<PdfBlockStorage, Map<string, StorageLock>>();
const storageEpochs = new WeakMap<PdfBlockStorage, Map<string, number>>();
const storageDenials = new WeakMap<PdfBlockStorage, Set<string>>();

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
  }

  metadata(key: string): Promise<PdfDescriptor | null> {
    return this.locked(key, false, prefix => this.loadMetadata(prefix));
  }

  async setMetadata(key: string, descriptor: PdfDescriptor): Promise<void> {
    const prefix = this.prefix(key), epoch = this.epochs.get(prefix) ?? 0;
    const check = () => {this.guard(); if ((this.epochs.get(prefix) ?? 0) !== epoch) throw new Error('PDF access revoked');};
    return this.locked(key, true, async prefix => {
      check();
      const tombstones = await this.denials(prefix); check();
      const pdf = descriptorValue(descriptor);
      const previous = await this.loadMetadata(prefix); check();
      if (!sameDocument(previous, pdf)) {await this.clear(prefix); check();}
      const manifest: Manifest = {version: MANIFEST_VERSION, blockSize: PDF_BLOCK_SIZE, descriptor: pdf};
      await this.io(() => this.storage.writeAtomic(`${prefix}manifest.json`, encoder.encode(JSON.stringify(manifest)))); check();
      for (const path of tombstones) {await this.io(() => this.storage.remove(path)); check();}
      this.denied.delete(prefix);
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
      const stored = await this.loadMetadata(prefix);
      this.guard();
      if (!sameDocument(stored, pdf)) return null;
      const result = new Uint8Array(end - begin);
      for (let offset = Math.floor(begin / PDF_BLOCK_SIZE) * PDF_BLOCK_SIZE; offset < end; offset += PDF_BLOCK_SIZE) {
        const block = await this.loadBlock(prefix, pdf, offset);
        this.guard();
        if (!block) return null;
        const left = Math.max(begin, offset), right = Math.min(end, offset + block.byteLength);
        result.set(block.subarray(left - offset, right - offset), left - begin);
      }
      return result;
    });
  }

  writeBlock(key: string, descriptor: PdfDescriptor, begin: number, bytes: Uint8Array): Promise<void> {
    return this.locked(key, true, async prefix => {
      const pdf = descriptorValue(descriptor);
      if (!Number.isSafeInteger(begin) || begin < 0 || begin >= pdf.size || begin % PDF_BLOCK_SIZE !== 0 ||
          !(bytes instanceof Uint8Array) || bytes.byteLength !== Math.min(PDF_BLOCK_SIZE, pdf.size - begin)) throw new Error('Invalid PDF block');
      const block = new Uint8Array(bytes);
      const stored = await this.loadMetadata(prefix);
      this.guard();
      if (!sameDocument(stored, pdf)) throw new Error('PDF cache identity changed');
      await this.io(() => this.storage.writeAtomic(this.blockPath(prefix, pdf, begin), block));
      this.guard();
    });
  }

  status(key: string): Promise<PdfCacheStatus> {
    return this.locked(key, false, async prefix => {
      const pdf = await this.loadMetadata(prefix);
      this.guard();
      if (!pdf) return {downloadedBytes: 0, totalBytes: 0, complete: false};
      const result = await this.scan(prefix, pdf);
      this.guard();
      return result;
    });
  }

  verify(key: string, descriptor: PdfDescriptor): Promise<boolean> {
    return this.locked(key, false, async prefix => {
      const pdf = descriptorValue(descriptor);
      const stored = await this.loadMetadata(prefix);
      this.guard();
      if (!sameDocument(stored, pdf)) return false;
      const result = await this.scan(prefix, pdf);
      this.guard();
      return result.complete;
    });
  }

  remove(key: string, check: () => void = () => {}): Promise<void> {
    const guard = () => {this.guard(); check();};
    return this.locked(key, true, prefix => this.clear(prefix, guard), guard);
  }

  bytes(key: string): Promise<number> {
    return this.locked(key, false, async prefix => {
      const pdf = await this.loadMetadata(prefix);
      this.guard();
      if (!pdf) return 0;
      const paths = await this.blockInventory(prefix, pdf);
      this.guard();
      const total = await this.measure(prefix, pdf, paths);
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

  private async denials(prefix: string): Promise<string[]> {
    const directory = `${prefix}denials/`, paths = await this.io(() => this.storage.list(directory));
    return paths.filter(path => path.startsWith(directory) && /^denied-\d+-\d+\.json$/.test(path.slice(directory.length)));
  }

  private async loadMetadata(prefix: string): Promise<PdfDescriptor | null> {
    if (this.denied.has(prefix) || (await this.denials(prefix)).length) return null;
    const bytes = await this.io(() => this.storage.read(`${prefix}manifest.json`));
    this.guard();
    if (!bytes) return null;
    try {
      const manifest = JSON.parse(decoder.decode(bytes)) as Manifest | null;
      if (manifest?.version !== MANIFEST_VERSION || manifest.blockSize !== PDF_BLOCK_SIZE) return null;
      return descriptorValue(manifest.descriptor);
    } catch {return null;}
  }

  private blockPath(prefix: string, pdf: PdfDescriptor, begin: number): string {
    return `${prefix}${pdf.document_id}-${pdf.size}/${begin}.block`;
  }

  private async loadBlock(prefix: string, pdf: PdfDescriptor, begin: number): Promise<Uint8Array | null> {
    const bytes = await this.io(() => this.storage.read(this.blockPath(prefix, pdf, begin)));
    this.guard();
    return bytes?.byteLength === Math.min(PDF_BLOCK_SIZE, pdf.size - begin) ? bytes : null;
  }

  private async blockInventory(prefix: string, pdf: PdfDescriptor): Promise<Set<string>> {
    const paths = await this.io(() => this.storage.list(`${prefix}${pdf.document_id}-${pdf.size}/`));
    this.guard();
    return new Set(paths);
  }

  private async yieldTurn(): Promise<void> {
    this.guard();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    this.guard();
  }

  private async measure(prefix: string, pdf: PdfDescriptor, paths: Set<string>): Promise<number> {
    let total = 0;
    for (let begin = 0; begin < pdf.size; begin += PDF_BLOCK_SIZE) {
      if (begin % (PDF_BLOCK_SIZE * 8) === 0) {await this.yieldTurn(); this.guard();}
      const path = this.blockPath(prefix, pdf, begin);
      if (!paths.has(path)) continue;
      const size = this.storage.size
        ? await this.io(() => this.storage.size!(path))
        : (await this.loadBlock(prefix, pdf, begin))?.byteLength;
      this.guard();
      if (size === Math.min(PDF_BLOCK_SIZE, pdf.size - begin)) total += size;
    }
    return total;
  }

  private async scan(prefix: string, pdf: PdfDescriptor): Promise<PdfCacheStatus> {
    this.guard();
    const key = `${prefix}${pdf.document_id}-${pdf.size}`;
    let pending = this.scans.get(key);
    if (!pending) {
      pending = this.scanBlocks(prefix, pdf);
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

  private async scanBlocks(prefix: string, pdf: PdfDescriptor): Promise<PdfCacheStatus> {
    const paths = await this.blockInventory(prefix, pdf);
    this.guard();
    let allPresent = true;
    for (let begin = 0; begin < pdf.size; begin += PDF_BLOCK_SIZE) {
      if (!paths.has(this.blockPath(prefix, pdf, begin))) {allPresent = false; break;}
    }
    if (!allPresent || this.storage.size) {
      const downloadedBytes = await this.measure(prefix, pdf, paths);
      this.guard();
      if (downloadedBytes !== pdf.size) return {downloadedBytes, totalBytes: pdf.size, complete: false};
    }
    const hash = new Sha256();
    let downloadedBytes = 0;
    for (let begin = 0; begin < pdf.size; begin += PDF_BLOCK_SIZE) {
      const block = await this.loadBlock(prefix, pdf, begin);
      this.guard();
      if (block) {
        downloadedBytes += block.byteLength;
        await hash.updateAsync(block, this.guard);
        this.guard();
      } else {await this.yieldTurn(); this.guard();}
    }
    return {downloadedBytes, totalBytes: pdf.size, complete: downloadedBytes === pdf.size && hash.digest() === pdf.document_id};
  }

  private async clear(prefix: string, guard = this.guard, bestEffort = false): Promise<void> {
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
