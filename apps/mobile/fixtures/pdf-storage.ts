import {Directory, File, Paths} from 'expo-file-system';
import {uuid} from 'expo';
import type {PdfBlockStorage} from '../src/data/pdf-cache';
import {Sha256} from '../src/data/pdf-sha256';
import {assertFixtureScope} from './isolation';

export class FixturePdfStorage implements PdfBlockStorage {
  constructor(private scope: string, private guard: () => void = () => {}) {this.check();}
  private check() {
    this.guard();
    assertFixtureScope(this.scope, Paths.cache.uri, JSON.parse(new File(this.scope, 'slax-fixture.json').textSync()));
  }
  private uri(path: string) {
    this.check();
    if (!(path === 'pdf' || path.startsWith('pdf/')) || !path.split('/').every(part => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..')) throw new Error('Unsafe fixture PDF path');
    return `${this.scope.replace(/\/$/, '')}/${path}`;
  }
  private versions(path: string): string[] {
    const directory = new Directory(this.uri(`${path}.entries`));
    return directory.exists ? directory.list().filter(item => item instanceof File && /^\d{16}-[\w-]+\.data$/.test(item.name)).map(item => item.name).sort().reverse() : [];
  }
  async size(path: string): Promise<number | null> {
    const version = this.versions(path)[0];
    return version ? new File(this.uri(`${path}.entries/${version}`)).size : null;
  }
  async read(path: string) {
    const version = this.versions(path)[0]; if (!version) return null;
    const file = new File(this.uri(`${path}.entries/${version}`));
    if (file.size > 1024 * 1024) throw new Error('Fixture PDF block exceeds limit');
    const bytes = await file.bytes(); this.check(); return bytes;
  }
  async writeAtomic(path: string, bytes: Uint8Array) {
    const previous = this.versions(path), sequence = previous.length ? Number(previous[0]!.slice(0, 16)) + 1 : 1;
    if (!Number.isSafeInteger(sequence)) throw new Error('Fixture PDF generation exhausted');
    const directory = new Directory(this.uri(`${path}.entries`)); directory.create({intermediates: true, idempotent: true});
    const name = `${String(sequence).padStart(16, '0')}-${uuid.v4()}`, temporaryPath = `${path}.entries/${name}.tmp`;
    const temporary = new File(this.uri(temporaryPath));
    let committed = false;
    try {
      temporary.create(); temporary.write(bytes); this.check();
      temporary.moveSync(new File(this.uri(`${path}.entries/${name}.data`))); committed = true; this.check();
      for (const old of previous) {const file = new File(this.uri(`${path}.entries/${old}`)); if (file.exists) file.delete();}
    } finally {if (!committed) {const abandoned = new File(this.uri(temporaryPath)); if (abandoned.exists) abandoned.delete();}}
  }
  async remove(path: string) {this.removeDirectory(`${path}.entries`);}
  async list(prefix: string) {
    const result: string[] = [];
    const visit = (path: string) => {
      const directory = new Directory(this.uri(path));
      if (directory.exists) for (const child of directory.list()) {
        const next = `${path}/${child.name}`; this.uri(next);
        if (child instanceof Directory) {if (child.name.endsWith('.entries')) result.push(next.slice(0, -8)); else visit(next);}
      }
    };
    visit(prefix.replace(/\/$/, '')); this.check(); return result;
  }
  clearScope(scope: string) {this.removeDirectory(`pdf/v1/${new Sha256().update(new TextEncoder().encode(JSON.stringify(scope))).digest()}`);}
  clear() {this.removeDirectory('pdf');}
  private removeDirectory(path: string) {const directory = new Directory(this.uri(path)); if (directory.exists) directory.delete();}
}
