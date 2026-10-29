import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {throwIfAborted} from '../../src/utils/abort.ts';

export function memoryNativeFileStore(contents) {
  let readWait, writeWait, sequence = 0;
  const writes = new Set(), calls = [];
  const uri = (directory, path) => `${directory.startsWith('file:') ? directory : `file://${directory}`}/${path}`;
  const bytes = value => typeof value === 'string' ? new TextEncoder().encode(value).length : value?.byteLength ?? 0;
  const native = {
    beginWrite() {const id = String(++sequence); writes.add(id); return id;},
    endWrite(_owner, id) {writes.delete(id);},
    async writeImage(directory, owner, id, path, value) {calls.push(['image', owner, path]); await writeWait; if (!writes.has(id)) throw new Error('Native write cancelled'); const result = uri(directory, path); contents.set(result, value); return result;},
    async readText(directory, owner, path) {calls.push(['read', owner, path]); await readWait; return contents.get(uri(directory, path)) ?? null;},
    async writeText(directory, owner, path, value) {calls.push(['write', owner, path]); await writeWait; contents.set(uri(directory, path), value); return uri(directory, path);},
    async size(directory, owner, path) {calls.push(['size', owner, path]); const value = contents.get(uri(directory, path)); return value === undefined ? null : bytes(value);},
    async measure(directory, owner, path) {calls.push(['measure', owner, path]); const prefix = `${uri(directory, path)}/`; return [...contents].reduce((sum, [key, value]) => sum + (key.startsWith(prefix) ? bytes(value) : 0), 0);},
    async remove(directory, owner, path) {calls.push(['remove', owner, path]); const base = uri(directory, path); for (const key of contents.keys()) if (key === base || key.startsWith(`${base}/`)) contents.delete(key);},
  };
  const filename = new URL('../../src/data/native-file-store.ts', import.meta.url), exports = {};
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(output, {exports, require(name) {
    if (name === 'expo') return {requireNativeModule: () => native};
    if (name === '../utils/abort.ts') return {throwIfAborted};
    throw new Error(`Unexpected native file adapter import ${name}`);
  }});
  return {NativeFileStore: exports.NativeFileStore, calls, waitRead(value) {readWait = value;}, waitWrite(value) {writeWait = value;}, pendingWrites: () => writes.size};
}
