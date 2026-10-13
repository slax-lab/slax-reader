import {Directory, File} from 'expo-file-system';
import {requireNativeModule, uuid} from 'expo-modules-core';
import type {PdfBlockStorage} from './pdf-cache.ts';
import {Sha256} from './pdf-sha256.ts';

type PdfPaths = {pdfCacheFileUri(directory: string, path: string): string | null};
export class PdfFileStorage implements PdfBlockStorage {
  private directory: string;
  private guard: () => void;
  constructor(directory: string, guard: () => void = () => {}) {this.directory = directory; this.guard = guard;}
  private uri(path: string): string {
    this.guard();
    if (!(path === 'pdf' || path.startsWith('pdf/')) || !path.split('/').every(part => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..')) throw new Error('Invalid PDF cache path');
    const uri = requireNativeModule<PdfPaths>('SlaxCachePaths').pdfCacheFileUri(this.directory, path);
    if (!uri) throw new Error('Unsafe PDF cache path');
    this.guard(); return uri;
  }
  private versions(path: string): string[] {
    const directory = new Directory(this.uri(`${path}.entries`));
    return directory.exists ? directory.list().filter(item => item instanceof File && /^\d{16}-[\w-]+\.data$/.test(item.name)).map(item => item.name).sort().reverse() : [];
  }
  async size(path: string): Promise<number | null> {
    const version = this.versions(path)[0]; if (!version) return null;
    return new File(this.uri(`${path}.entries/${version}`)).size;
  }
  async read(path: string): Promise<Uint8Array | null> {
    const version = this.versions(path)[0]; if (!version) return null;
    const versionPath = `${path}.entries/${version}`, file = new File(this.uri(versionPath));
    if (file.size > 1024 * 1024) throw new Error('PDF cache block exceeds limit');
    try {const bytes = await file.bytes(); this.uri(versionPath); return bytes;} finally {this.guard();}
  }
  async writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
    const previous = this.versions(path), sequence = previous.length ? Number(previous[0].slice(0, 16)) + 1 : 1;
    if (!Number.isSafeInteger(sequence)) throw new Error('PDF cache generation exhausted');
    const directory = new Directory(this.uri(`${path}.entries`)); directory.create({intermediates: true, idempotent: true});
    const name = `${String(sequence).padStart(16, '0')}-${uuid.v4()}`, temporaryPath = `${path}.entries/${name}.tmp`;
    const temporary = new File(this.uri(temporaryPath));
    let committed = false;
    try {
      temporary.create(); temporary.write(bytes); this.guard();
      temporary.moveSync(new File(this.uri(`${path}.entries/${name}.data`))); committed = true; this.guard();
      for (const old of previous) {const file = new File(this.uri(`${path}.entries/${old}`)); if (file.exists) file.delete();}
    } finally {if (!committed) {const abandoned = new File(this.uri(temporaryPath)); if (abandoned.exists) abandoned.delete();}}
  }
  async remove(path: string): Promise<void> {const directory = new Directory(this.uri(`${path}.entries`)); if (directory.exists) directory.delete();}
  async list(prefix: string): Promise<string[]> {
    const root = prefix.replace(/\/$/, ''), result: string[] = [];
    const visit = (path: string) => {
      const directory = new Directory(this.uri(path));
      if (!directory.exists) return;
      for (const item of directory.list()) {
        const child = `${path}/${item.name}`; this.uri(child);
        if (item instanceof Directory) {if (item.name.endsWith('.entries')) result.push(child.slice(0, -8)); else visit(child);}
      }
    };
    visit(root); this.guard(); return result;
  }
  clearScope(scope: string): void {
    const hash = new Sha256().update(new TextEncoder().encode(JSON.stringify(scope))).digest();
    const directory = new Directory(this.uri(`pdf/v1/${hash}`)); if (directory.exists) directory.delete();
  }
  clear(): void {const directory = new Directory(this.uri('pdf')); if (directory.exists) directory.delete();}
}
