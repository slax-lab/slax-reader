import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {PDF_BLOCK_SIZE, PDF_MAX_RANGE_BYTES, PdfBlockCache, type PdfBlockStorage, type PdfDescriptor} from '../../src/data/pdf-cache.ts';
import {Sha256} from '../../src/data/pdf-sha256.ts';

const encoder = new TextEncoder();
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const data = (size: number) => Uint8Array.from({length: size}, (_, index) => (index * 31 + (index >>> 8)) & 255);
const descriptor = (bytes: Uint8Array): PdfDescriptor => ({url: '/v1/bookmark/pdf?bookmark_uid=book', filename: '文档.pdf',
  document_id: digest(bytes), size: bytes.byteLength, source: 'upload', text_status: 'ready', pages: 2});
class MemoryStorage implements PdfBlockStorage {
  files = new Map<string, Uint8Array>();
  calls: {method: string; path: string; size?: number}[] = [];
  before?: (method: string, path: string) => Promise<void> | void;
  after?: (method: string, path: string) => Promise<void> | void;
  async read(path: string) {
    this.calls.push({method: 'read', path});
    await this.before?.('read', path);
    const result = this.files.get(path)?.slice() ?? null;
    await this.after?.('read', path);
    return result;
  }
  async writeAtomic(path: string, bytes: Uint8Array) {
    this.calls.push({method: 'writeAtomic', path, size: bytes.byteLength});
    await this.before?.('writeAtomic', path);
    this.files.set(path, bytes.slice());
    await this.after?.('writeAtomic', path);
  }
  async remove(path: string) {
    this.calls.push({method: 'remove', path});
    await this.before?.('remove', path);
    this.files.delete(path);
    await this.after?.('remove', path);
  }
  async list(prefix: string) {
    this.calls.push({method: 'list', path: prefix});
    await this.before?.('list', prefix);
    const result = [...this.files.keys()].filter(path => path.startsWith(prefix));
    await this.after?.('list', prefix);
    return result;
  }
}
const setup = (scope = 'https://api.example/account-1') => {
  const storage = new MemoryStorage();
  const cache = new PdfBlockCache(storage, scope, () => {});
  return {storage, cache};
};
async function populate(cache: PdfBlockCache, bytes: Uint8Array, key = 'book', pdf = descriptor(bytes)) {
  await cache.setMetadata(key, pdf);
  for (let begin = 0; begin < bytes.byteLength; begin += PDF_BLOCK_SIZE) {
    await cache.writeBlock(key, pdf, begin, bytes.subarray(begin, begin + PDF_BLOCK_SIZE));
  }
  return pdf;
}
function blockPath(storage: MemoryStorage, begin = 0): string {
  const path = [...storage.files.keys()].find(path => path.endsWith(`/${begin}.block`));
  assert.ok(path);
  return path;
}
function manifestPath(storage: MemoryStorage): string {
  const path = [...storage.files.keys()].find(path => path.endsWith('/manifest.json'));
  assert.ok(path);
  return path;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {resolve = done;});
  return {promise, resolve};
}

test('SHA-256 matches standard empty, abc, two-block and million-a vectors', () => {
  for (const [input, expected] of [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ]) assert.equal(new Sha256().update(encoder.encode(input)).digest(), expected);
});

test('SHA-256 handles padding/chunk boundaries, offset views and finalization', () => {
  for (const size of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1025, PDF_BLOCK_SIZE + 33]) {
    const bytes = data(size + 19).subarray(19);
    for (const chunkSize of [1, 7, 55, 64, 65, 257, PDF_BLOCK_SIZE]) {
      const hash = new Sha256();
      for (let begin = 0; begin < bytes.length; begin += chunkSize) {
        hash.update(bytes.subarray(begin, begin + chunkSize)).update(new Uint8Array());
      }
      assert.equal(hash.digest(), digest(bytes), `size=${size}, chunk=${chunkSize}`);
      assert.equal(hash.digest(), digest(bytes));
      assert.throws(() => hash.update(new Uint8Array()), /finalized/);
    }
  }
});

test('missing metadata and blocks are incomplete rather than an empty offline document', async () => {
  const {cache} = setup(), bytes = data(12), pdf = descriptor(bytes);
  assert.equal(await cache.metadata('book'), null);
  assert.equal(await cache.read('book', pdf, 0, 12), null);
  assert.equal(await cache.verify('book', pdf), false);
  assert.equal(await cache.bytes('book'), 0);
  assert.deepEqual(await cache.status('book'), {downloadedBytes: 0, totalBytes: 0, complete: false});
  await assert.rejects(cache.writeBlock('book', pdf, 0, bytes), /identity/);
  await cache.setMetadata('book', pdf);
  assert.deepEqual(await cache.status('book'), {downloadedBytes: 0, totalBytes: 12, complete: false});
});

test('metadata is versioned atomic UTF-8 JSON and survives reconstruction', async () => {
  const {storage, cache} = setup(), pdf = descriptor(data(31));
  await cache.setMetadata('book', pdf);
  const raw = storage.files.get(manifestPath(storage))!;
  assert.equal(new TextDecoder().decode(raw).includes('文档.pdf'), true);
  const manifest = JSON.parse(new TextDecoder().decode(raw));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.blockSize, PDF_BLOCK_SIZE);
  assert.deepEqual(manifest.descriptor, pdf);
  assert.deepEqual(await new PdfBlockCache(storage, 'https://api.example/account-1', () => {}).metadata('book'), pdf);
  const copy = await cache.metadata('book');
  copy!.filename = 'modified';
  assert.equal((await cache.metadata('book'))!.filename, pdf.filename);
});

test('arbitrary ranges read only intersecting aligned blocks and allocate the requested length', async () => {
  const {storage, cache} = setup(), bytes = data(PDF_BLOCK_SIZE * 6 + 19);
  const pdf = await populate(cache, bytes);
  storage.calls = [];
  const begin = PDF_BLOCK_SIZE - 7, end = begin + PDF_MAX_RANGE_BYTES;
  const result = await cache.read('book', pdf, begin, end);
  assert.deepEqual(result, bytes.slice(begin, end));
  assert.equal(result!.buffer.byteLength, PDF_MAX_RANGE_BYTES);
  const blocks = storage.calls.filter(call => call.path.endsWith('.block'));
  assert.equal(blocks.length, 5);
  assert.deepEqual(await cache.read('book', pdf, bytes.length - 9, bytes.length), bytes.slice(-9));
  await assert.rejects(cache.read('book', pdf, 0, PDF_MAX_RANGE_BYTES + 1), /range/);
  assert.equal(await cache.verify('book', pdf), true);
  assert.deepEqual(await cache.status('book'), {downloadedBytes: bytes.length, totalBytes: bytes.length, complete: true});
});

test('partial blocks resume across instances and absent or wrong-sized blocks do not count', async () => {
  const {storage, cache} = setup(), bytes = data(PDF_BLOCK_SIZE * 2 + 17), pdf = descriptor(bytes);
  await cache.setMetadata('book', pdf);
  await cache.writeBlock('book', pdf, PDF_BLOCK_SIZE, bytes.subarray(PDF_BLOCK_SIZE, PDF_BLOCK_SIZE * 2));
  const resumed = new PdfBlockCache(storage, 'https://api.example/account-1', () => {});
  assert.deepEqual(await resumed.status('book'), {downloadedBytes: PDF_BLOCK_SIZE, totalBytes: bytes.length, complete: false});
  assert.equal(await resumed.read('book', pdf, PDF_BLOCK_SIZE - 1, PDF_BLOCK_SIZE + 1), null);
  assert.deepEqual(await resumed.read('book', pdf, PDF_BLOCK_SIZE, PDF_BLOCK_SIZE + 7), bytes.slice(PDF_BLOCK_SIZE, PDF_BLOCK_SIZE + 7));
  await resumed.writeBlock('book', pdf, 0, bytes.subarray(0, PDF_BLOCK_SIZE));
  await resumed.writeBlock('book', pdf, PDF_BLOCK_SIZE * 2, bytes.subarray(PDF_BLOCK_SIZE * 2));
  assert.equal(await resumed.verify('book', pdf), true);
  storage.files.set(blockPath(storage, PDF_BLOCK_SIZE), new Uint8Array(PDF_BLOCK_SIZE - 1));
  assert.equal(await resumed.read('book', pdf, PDF_BLOCK_SIZE, PDF_BLOCK_SIZE + 1), null);
  assert.equal(await resumed.bytes('book'), PDF_BLOCK_SIZE + 17);
  assert.deepEqual(await resumed.status('book'), {downloadedBytes: PDF_BLOCK_SIZE + 17, totalBytes: bytes.length, complete: false});
  assert.equal(await resumed.verify('book', pdf), false);
});

test('complete status hashes actual bytes and never trusts stale completion metadata', async () => {
  const {storage, cache} = setup(), bytes = data(PDF_BLOCK_SIZE + 11);
  const pdf = await populate(cache, bytes);
  assert.equal(await cache.verify('book', pdf), true);
  const path = blockPath(storage);
  storage.files.get(path)![42] ^= 1;
  assert.equal(await cache.verify('book', pdf), false);
  assert.deepEqual(await cache.status('book'), {downloadedBytes: bytes.length, totalBytes: bytes.length, complete: false});
  await cache.writeBlock('book', pdf, 0, bytes.subarray(0, PDF_BLOCK_SIZE));
  assert.equal(await cache.verify('book', pdf), true);
  storage.files.delete(path);
  assert.equal((await cache.status('book')).complete, false);
});

test('new identity or length discards old blocks but presentation metadata preserves them', async () => {
  const {storage, cache} = setup(), bytes = data(PDF_BLOCK_SIZE + 13);
  const pdf = await populate(cache, bytes);
  const originalBlocks = [...storage.files.keys()].filter(path => path.endsWith('.block'));
  await cache.setMetadata('book', {...pdf, filename: 'renamed.pdf', text_status: 'empty'});
  assert.equal(await cache.verify('book', pdf), true);
  const nextBytes = bytes.slice(); nextBytes[0] ^= 1;
  const next = descriptor(nextBytes);
  await cache.setMetadata('book', next);
  for (const path of originalBlocks) assert.equal(storage.files.has(path), false);
  assert.equal(await cache.read('book', pdf, 0, 1), null);
  await assert.rejects(cache.writeBlock('book', pdf, 0, bytes.subarray(0, PDF_BLOCK_SIZE)), /identity/);
  await cache.writeBlock('book', next, 0, nextBytes.subarray(0, PDF_BLOCK_SIZE));
  await cache.setMetadata('book', {...next, size: next.size + 1});
  assert.equal(await cache.bytes('book'), 0);
  assert.equal(await cache.verify('book', next), false);
});

test('invalid keys, ranges, descriptors and non-exact blocks fail before writing', async () => {
  const {storage, cache} = setup(), bytes = data(PDF_BLOCK_SIZE + 17), pdf = descriptor(bytes);
  for (const key of ['', '../book', 'a/b', 'a\\b', '.', '..', 'book\n', 'a%2fb', '文档']) {
    await assert.rejects(cache.metadata(key), /key/);
    await assert.rejects(cache.setMetadata(key, pdf), /key/);
    await assert.rejects(cache.remove(key), /key/);
  }
  assert.equal(storage.calls.length, 0);
  for (const change of [{size: 0}, {size: 50 * 1024 * 1024 + 1}, {size: NaN}, {size: 1.1}, {pages: 0},
    {document_id: 'a'.repeat(63)}, {document_id: 'a'.repeat(64) + '\n'}, {document_id: '../evil'}, {filename: null}]) {
    await assert.rejects(cache.setMetadata('book', {...pdf, ...change} as PdfDescriptor), /descriptor/);
  }
  await cache.setMetadata('book', pdf);
  for (const [begin, end] of [[-1, 1], [0, 0], [2, 1], [0, bytes.length + 1], [0.5, 2], [0, NaN], [Infinity, Infinity]]) {
    await assert.rejects(cache.read('book', pdf, begin, end), /range/);
  }
  for (const [begin, length] of [[1, PDF_BLOCK_SIZE], [-PDF_BLOCK_SIZE, PDF_BLOCK_SIZE], [0, 0], [0, 1],
    [0, PDF_BLOCK_SIZE + 1], [PDF_BLOCK_SIZE, 16], [PDF_BLOCK_SIZE, 18], [PDF_BLOCK_SIZE * 2, 1]]) {
    await assert.rejects(cache.writeBlock('book', pdf, begin, new Uint8Array(length)), /block/);
  }
  assert.equal(storage.calls.filter(call => call.method === 'writeAtomic').length, 1);
});

test('scopes and bookmark access keys are isolated, path-safe and fixed length', async () => {
  const storage = new MemoryStorage(), bytes = data(17), pdf = descriptor(bytes);
  const scopes = ['prod/user', 'prod%2Fuser', 'prod/other', 'beta/user', '../../escape', '环境/账号', '\ud800', '\ufffd', 'x'.repeat(2000)];
  for (const scope of scopes) {
    const cache = new PdfBlockCache(storage, scope, () => {});
    assert.equal(await cache.metadata('book'), null);
    await populate(cache, bytes);
    assert.equal(await cache.metadata('owner-book'), null);
  }
  assert.equal(storage.files.size, scopes.length * 2);
  for (const path of storage.files.keys()) assert.match(path, /^pdf\/v1\/[a-f0-9]{64}\/book\/(manifest\.json|[a-f0-9]{64}-17\/0\.block)$/);
  await new PdfBlockCache(storage, scopes[0], () => {}).remove('book');
  assert.equal(await new PdfBlockCache(storage, scopes[1], () => {}).verify('book', pdf), true);
  assert.throws(() => new PdfBlockCache(storage, '', () => {}), /scope/);
});

test('malformed, unknown-version and invalid UTF-8 manifests are ignored and recoverable', async () => {
  const {storage, cache} = setup(), bytes = data(17), pdf = await populate(cache, bytes);
  const path = manifestPath(storage), original = storage.files.get(path)!;
  for (const invalid of [encoder.encode('{'), new Uint8Array([0xff]), encoder.encode('null'),
    encoder.encode(JSON.stringify({version: 2, blockSize: PDF_BLOCK_SIZE, descriptor: pdf})),
    encoder.encode(JSON.stringify({version: 1, blockSize: 1, descriptor: pdf})),
    encoder.encode(JSON.stringify({version: 1, blockSize: PDF_BLOCK_SIZE, descriptor: {...pdf, size: -1}}))]) {
    storage.files.set(path, invalid);
    assert.equal(await cache.metadata('book'), null);
    assert.equal(await cache.read('book', pdf, 0, 1), null);
    assert.equal(await cache.verify('book', pdf), false);
  }
  storage.files.set(path, original);
  await cache.setMetadata('book', pdf);
  assert.equal(await cache.verify('book', pdf), true);
  storage.files.set(path, encoder.encode('{'));
  await cache.setMetadata('book', pdf);
  assert.equal(await cache.bytes('book'), 0);
});

test('failed atomic block and manifest writes retain valid previous data and release locks', async () => {
  const {storage, cache} = setup(), bytes = data(17), pdf = await populate(cache, bytes);
  storage.before = method => {if (method === 'writeAtomic') throw new Error('disk full');};
  await assert.rejects(cache.writeBlock('book', pdf, 0, new Uint8Array(17)), /disk full/);
  await assert.rejects(cache.setMetadata('book', {...pdf, filename: 'new.pdf'}), /disk full/);
  assert.deepEqual(await cache.read('book', pdf, 0, 17), bytes);
  assert.deepEqual(await cache.metadata('book'), pdf);
  storage.before = undefined;
  await cache.writeBlock('book', pdf, 0, bytes);
  assert.equal(await cache.verify('book', pdf), true);
});

test('interrupted identity replacement cannot expose old bytes with new metadata', async () => {
  const {storage, cache} = setup(), bytes = data(17), pdf = await populate(cache, bytes);
  storage.before = (method, path) => {if (method === 'remove' && path.endsWith('.block')) throw new Error('interrupted');};
  const changed = {...pdf, document_id: 'a'.repeat(64)};
  await assert.rejects(cache.setMetadata('book', changed), /interrupted/);
  assert.equal(await cache.metadata('book'), null);
  assert.equal(await cache.read('book', changed, 0, 17), null);
  storage.before = undefined;
  await cache.setMetadata('book', changed);
  assert.equal(await cache.bytes('book'), 0);
});

test('concurrent instances serialize identity changes and reject stale block commits', async () => {
  const {storage, cache} = setup(), bytes = data(17), pdf = await populate(cache, bytes);
  const peer = new PdfBlockCache(storage, 'https://api.example/account-1', () => {});
  const entered = deferred(), release = deferred();
  storage.before = async (method, path) => {
    if (method === 'writeAtomic' && path.endsWith('manifest.json')) {entered.resolve(); await release.promise;}
  };
  const nextBytes = bytes.slice(); nextBytes[0] ^= 1;
  const next = descriptor(nextBytes);
  const replacement = cache.setMetadata('book', next);
  await entered.promise;
  const stale = peer.writeBlock('book', pdf, 0, bytes);
  const rejected = assert.rejects(stale, /identity/);
  release.resolve();
  await replacement;
  await rejected;
  assert.deepEqual(await peer.metadata('book'), next);
  assert.equal(await peer.bytes('book'), 0);
});

test('remove waits for outstanding writes and only removes its own cache paths', async () => {
  const {storage, cache} = setup(), bytes = data(17), pdf = await populate(cache, bytes);
  await populate(cache, bytes, 'book-other');
  storage.files.set('comments/pending', encoder.encode('keep'));
  const entered = deferred(), release = deferred();
  storage.before = async (method, path) => {
    if (method === 'writeAtomic' && path.endsWith('.block')) {entered.resolve(); await release.promise;}
  };
  const writing = cache.writeBlock('book', pdf, 0, bytes);
  await entered.promise;
  const removing = cache.remove('book');
  release.resolve();
  await Promise.all([writing, removing]);
  assert.equal(await cache.metadata('book'), null);
  assert.equal(await cache.verify('book-other', pdf), true);
  assert.equal(storage.files.has('comments/pending'), true);
  assert.equal([...storage.files.keys()].some(path => path.includes('/book/')), false);
  await cache.remove('book');
});

test('unsafe list results cannot escape the requested cache key', async () => {
  const {storage, cache} = setup(), bytes = data(17);
  await populate(cache, bytes);
  const originalList = storage.list.bind(storage);
  storage.list = async prefix => [...await originalList(prefix), 'comments/pending', `${prefix}../other`, `${prefix}nested/../../other`, `${prefix}a\\b`];
  await cache.remove('book');
  assert.equal(storage.calls.some(call => call.method === 'remove' && (call.path.includes('..') || call.path.includes('\\') || call.path === 'comments/pending')), false);
});

test('revoked scopes cannot start I/O or return results after delayed I/O', async () => {
  const storage = new MemoryStorage();
  let active = true;
  const cache = new PdfBlockCache(storage, 'scope', () => {if (!active) throw new Error('revoked');});
  const bytes = data(17), pdf = await populate(cache, bytes);
  for (const operation of [() => cache.metadata('book'), () => cache.read('book', pdf, 0, 1), () => cache.verify('book', pdf),
    () => cache.status('book'), () => cache.bytes('book'), () => cache.writeBlock('book', pdf, 0, bytes),
    () => cache.setMetadata('book', pdf), () => cache.remove('book')]) {
    active = true;
    storage.after = () => {active = false;};
    await assert.rejects(operation(), /revoked/);
    storage.after = undefined;
    const count = storage.calls.length;
    await assert.rejects(operation(), /revoked/);
    assert.equal(storage.calls.length, count);
  }
});

test('guard checks follow rejected storage awaits and completed atomic writes', async () => {
  const storage = new MemoryStorage();
  let active = true;
  const cache = new PdfBlockCache(storage, 'scope', () => {if (!active) throw new Error('revoked');});
  const bytes = data(17), pdf = await populate(cache, bytes);
  storage.before = () => {active = false; throw new Error('disk error');};
  await assert.rejects(cache.metadata('book'), /revoked/);
  active = true; storage.before = undefined;
  storage.after = method => {if (method === 'writeAtomic') active = false;};
  await assert.rejects(cache.writeBlock('book', pdf, 0, bytes), /revoked/);
});

test('async SHA-256 yields real turns in at most 64-KiB chunks and supports revocation', async () => {
  const bytes = data(PDF_BLOCK_SIZE + 7), hash = new Sha256();
  const sizes: number[] = [];
  const update = hash.update.bind(hash);
  hash.update = chunk => {sizes.push(chunk.byteLength); return update(chunk);};
  let ticks = 0;
  const timer = setInterval(() => {ticks++;}, 0);
  try {
    await hash.updateAsync(bytes, () => {});
    assert.equal(hash.digest(), digest(bytes));
    assert.deepEqual(sizes, [65536, 65536, 65536, 65536, 7]);
    assert.ok(ticks >= 5, `timer ticks: ${ticks}`);
  } finally {clearInterval(timer);}
  let active = true, updates = 0;
  const cancelled = new Sha256();
  cancelled.update = () => {updates++; return cancelled;};
  const revoke = setTimeout(() => {active = false;}, 0);
  try {
    await assert.rejects(cancelled.updateAsync(bytes, () => {if (!active) throw new Error('revoked');}), /revoked/);
    assert.equal(updates, 0);
  } finally {clearTimeout(revoke);}
});

test('partial progress and byte accounting use optional file sizes without loading block payloads', async () => {
  const storage = new MemoryStorage() as MemoryStorage & Required<Pick<PdfBlockStorage, 'size'>>;
  storage.size = async path => {storage.calls.push({method: 'size', path}); return storage.files.get(path)?.byteLength ?? null;};
  const cache = new PdfBlockCache(storage, 'scope', () => {});
  const bytes = data(PDF_BLOCK_SIZE * 4 + 17), pdf = descriptor(bytes);
  await cache.setMetadata('book', pdf);
  await cache.writeBlock('book', pdf, 0, bytes.subarray(0, PDF_BLOCK_SIZE));
  await cache.writeBlock('book', pdf, PDF_BLOCK_SIZE * 4, bytes.subarray(PDF_BLOCK_SIZE * 4));
  storage.calls = [];
  assert.deepEqual(await cache.status('book'), {downloadedBytes: PDF_BLOCK_SIZE + 17, totalBytes: bytes.length, complete: false});
  assert.equal(await cache.bytes('book'), PDF_BLOCK_SIZE + 17);
  assert.equal(storage.calls.filter(call => call.method === 'size').length, 4);
  assert.equal(storage.calls.filter(call => call.method === 'read' && call.path.endsWith('.block')).length, 0);
  await populate(cache, bytes);
  assert.equal((await cache.status('book')).complete, true);
  storage.files.get(blockPath(storage))![13] ^= 1;
  assert.equal((await cache.status('book')).complete, false);
  assert.equal(await cache.bytes('book'), bytes.length);
  storage.files.set(blockPath(storage), new Uint8Array(5));
  storage.calls = [];
  assert.deepEqual(await cache.status('book'), {downloadedBytes: bytes.length - PDF_BLOCK_SIZE, totalBytes: bytes.length, complete: false});
  assert.equal(storage.calls.filter(call => call.method === 'read' && call.path.endsWith('.block')).length, 0);
});

test('read-only range access is not held behind a blocked whole-document scan', async () => {
  const {storage, cache} = setup(), bytes = data(PDF_BLOCK_SIZE * 2 + 7), pdf = await populate(cache, bytes);
  const peer = new PdfBlockCache(storage, 'https://api.example/account-1', () => {});
  const entered = deferred(), release = deferred();
  storage.before = async (method, path) => {
    if (method === 'read' && path.endsWith(`/${PDF_BLOCK_SIZE}.block`)) {entered.resolve(); await release.promise;}
  };
  const scanning = cache.status('book');
  await entered.promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      peer.read('book', pdf, 0, 7),
      new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error('reader blocked by scan')), 250);}),
    ]);
    assert.deepEqual(result, bytes.slice(0, 7));
  } finally {clearTimeout(timer); release.resolve();}
  assert.equal((await scanning).complete, true);
});

test('overlapping status and verification join one scan but later polls recheck corruption', async () => {
  const {storage, cache} = setup(), bytes = data(PDF_BLOCK_SIZE + 7), pdf = await populate(cache, bytes);
  const entered = deferred(), release = deferred();
  let first = true;
  storage.before = async (method, path) => {
    if (first && method === 'read' && path.endsWith('.block')) {first = false; entered.resolve(); await release.promise;}
  };
  storage.calls = [];
  const status = cache.status('book');
  await entered.promise;
  const joined = cache.status('book'), verified = cache.verify('book', pdf);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  release.resolve();
  const results = await Promise.all([status, joined, verified]);
  assert.equal(results[0].complete, true);
  assert.equal(results[1].complete, true);
  assert.equal(results[2], true);
  assert.equal(storage.calls.filter(call => call.method === 'read' && call.path.endsWith('.block')).length, 2);
  storage.files.get(blockPath(storage))![2] ^= 1;
  assert.equal((await cache.status('book')).complete, false);
});

test('pending writes fence later readers and cannot interleave with a verified snapshot', async () => {
  const {storage, cache} = setup(), bytes = data(PDF_BLOCK_SIZE + 7), pdf = await populate(cache, bytes);
  const entered = deferred(), release = deferred();
  let first = true;
  storage.before = async (method, path) => {
    if (first && method === 'read' && path.endsWith('.block')) {first = false; entered.resolve(); await release.promise;}
  };
  const scanning = cache.verify('book', pdf);
  await entered.promise;
  const changed = bytes.slice(); changed[0] ^= 1;
  const writing = cache.writeBlock('book', pdf, 0, changed.subarray(0, PDF_BLOCK_SIZE));
  let readFinished = false;
  const reading = cache.read('book', pdf, 0, 1).then(value => {readFinished = true; return value;});
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(readFinished, false);
  release.resolve();
  assert.equal(await scanning, true);
  await writing;
  assert.deepEqual(await reading, changed.slice(0, 1));
  assert.equal(await cache.verify('book', pdf), false);
});

test('interrupted denial cleanup preserves a tombstone through ordinary removal until authorized metadata replaces it', async () => {
  const {storage, cache} = setup(), bytes = data(8), pdf = await populate(cache, bytes);
  storage.before = (method, path) => {if (method === 'remove' && path.endsWith('/manifest.json')) throw new Error('Interrupted cleanup');};
  await assert.rejects(cache.invalidate('book'), error => error instanceof AggregateError && error.errors.every(reason => reason.message === 'Interrupted cleanup'));
  storage.before = undefined;
  const restarted = new PdfBlockCache(storage, 'https://api.example/account-1', () => {});
  assert.equal(await restarted.metadata('book'), null); assert.equal(await restarted.read('book', pdf, 0, 3), null);
  assert.equal((await restarted.status('book')).complete, false); assert.equal(await restarted.bytes('book'), 0);
  await restarted.remove('book');
  assert([...storage.files.keys()].some(path => /denied-\d+-\d+\.json$/.test(path)));
  await restarted.setMetadata('book', pdf);
  assert.equal([...storage.files.keys()].some(path => /denied-\d+-\d+\.json$/.test(path)), false);
  await restarted.writeBlock('book', pdf, 0, bytes); assert.deepEqual(await restarted.read('book', pdf, 0, 3), bytes.slice(0, 3));
});

test('a denial arriving during authorized metadata persistence fences that stale response', async () => {
  const {storage, cache} = setup(), bytes = data(8), pdf = await populate(cache, bytes);
  const entered = deferred(), release = deferred();
  storage.before = async (method, path) => {if (method === 'writeAtomic' && path.endsWith('/manifest.json')) {entered.resolve(); await release.promise;}};
  const updating = cache.setMetadata('book', {...pdf, filename: 'renamed.pdf'}), rejected = assert.rejects(updating, /revoked/);
  await entered.promise;
  const invalidating = cache.invalidate('book');
  release.resolve(); await rejected; await invalidating;
  assert.equal(await cache.metadata('book'), null); assert.equal(await cache.read('book', pdf, 0, 3), null);
  assert([...storage.files.keys()].some(path => /denied-\d+-\d+\.json$/.test(path)));
});

test('ENOSPC creating a denial marker still deletes cached files before a fresh offline instance can read them', async () => {
  const {storage, cache} = setup(), bytes = data(8), pdf = await populate(cache, bytes);
  storage.before = (method, path) => {if (method === 'writeAtomic' && path.includes('/denials/')) throw new Error('ENOSPC');};
  await assert.rejects(cache.invalidate('book'), /ENOSPC/);
  assert(storage.calls.some(call => call.method === 'remove' && call.path.endsWith('/manifest.json')));
  assert.equal(storage.files.size, 0);
  const freshStorage = new MemoryStorage(); freshStorage.files = storage.files;
  const restarted = new PdfBlockCache(freshStorage, 'https://api.example/account-1', () => {});
  assert.equal(await restarted.metadata('book'), null); assert.equal(await restarted.read('book', pdf, 0, 3), null);
});

test('if marker creation and manifest removal fail, denial cleanup still attempts every block', async () => {
  const {storage, cache} = setup(), bytes = data(PDF_BLOCK_SIZE + 3), pdf = await populate(cache, bytes);
  storage.before = (method, path) => {
    if (method === 'writeAtomic' && path.includes('/denials/')) throw new Error('ENOSPC');
    if (method === 'remove' && path.endsWith('/manifest.json')) throw new Error('manifest locked');
  };
  await assert.rejects(cache.invalidate('book'), /persistence and cleanup failed/);
  assert.equal([...storage.files.keys()].filter(path => path.endsWith('.block')).length, 0);
  const peer = new PdfBlockCache(storage, 'https://api.example/account-1', () => {});
  assert.equal(await peer.metadata('book'), null); assert.equal(await peer.read('book', pdf, 0, 3), null);
});

test('total filesystem mutation failure remains denied across cache instances until explicit authorization', async () => {
  const {storage, cache} = setup(), bytes = data(8), pdf = await populate(cache, bytes);
  storage.before = method => {if (method === 'writeAtomic' || method === 'remove') throw new Error('read-only filesystem');};
  await assert.rejects(cache.invalidate('book'), /persistence and cleanup failed/);
  assert.equal(storage.files.size, 2);
  const peer = new PdfBlockCache(storage, 'https://api.example/account-1', () => {});
  assert.equal(await cache.metadata('book'), null); assert.equal(await peer.metadata('book'), null); assert.equal(await peer.read('book', pdf, 0, 3), null);
  storage.before = undefined;
  await peer.setMetadata('book', pdf); await peer.writeBlock('book', pdf, 0, bytes);
  assert.deepEqual(await peer.read('book', pdf, 0, 3), bytes.slice(0, 3));
});

async function* stream(bytes: Uint8Array, size = 93_137) {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
}
const manifestValue = (storage: MemoryStorage) => JSON.parse(new TextDecoder().decode(storage.files.get(manifestPath(storage))!));

test('full PDF streams publish bounded atomic blocks and arbitrary ranges survive a cold storage restart', async () => {
  const {cache, storage} = setup(), bytes = data(PDF_BLOCK_SIZE * 5 + 19), pdf = descriptor(bytes);
  await cache.setMetadata('book', pdf); storage.calls = [];
  await cache.writeComplete('book', pdf, stream(bytes));
  const manifest = manifestValue(storage);
  assert.match(manifest.generation, /^full-/);
  const writes = storage.calls.filter(call => call.method === 'writeAtomic' && call.path.endsWith('.block'));
  assert.equal(writes.length, 6); assert(writes.every(call => call.size! <= PDF_BLOCK_SIZE));
  assert(writes.every(call => call.path.includes(`/${manifest.generation}/`)));
  const restartedStorage = new MemoryStorage(); restartedStorage.files = storage.files;
  const restarted = new PdfBlockCache(restartedStorage, 'https://api.example/account-1', () => {});
  assert.deepEqual(await restarted.read('book', pdf, PDF_BLOCK_SIZE - 3, PDF_BLOCK_SIZE * 4 + 3), bytes.slice(PDF_BLOCK_SIZE - 3, PDF_BLOCK_SIZE * 4 + 3));
  assert.equal(await restarted.verify('book', pdf), true); assert.equal(await restarted.bytes('book'), bytes.length);
  await restarted.setMetadata('book', {...pdf, filename: 'renamed.pdf', text_status: 'empty'});
  assert.equal(manifestValue(storage).generation, manifest.generation);
  assert.equal(await restarted.verify('book', pdf), true);
  storage.files.get(writes[2].path)![7] ^= 1;
  assert.equal(await restarted.verify('book', pdf), false);
});

test('a held complete stream neither publishes partial staging nor blocks cached ranges or metadata updates', {timeout: 3000}, async () => {
  const {cache, storage} = setup(), bytes = data(PDF_BLOCK_SIZE + 19), pdf = descriptor(bytes);
  await cache.setMetadata('book', pdf); await cache.writeBlock('book', pdf, 0, bytes.subarray(0, PDF_BLOCK_SIZE));
  const entered = deferred(), release = deferred();
  const writing = cache.writeComplete('book', pdf, (async function* () {yield bytes.subarray(0, PDF_BLOCK_SIZE); entered.resolve(); await release.promise; yield bytes.subarray(PDF_BLOCK_SIZE);})());
  try {
    await entered.promise;
    assert.equal(manifestValue(storage).generation, undefined);
    assert.deepEqual(await cache.read('book', pdf, 0, 11), bytes.slice(0, 11));
    assert.equal(await cache.read('book', pdf, PDF_BLOCK_SIZE, pdf.size), null);
    assert.deepEqual(await cache.status('book'), {downloadedBytes: PDF_BLOCK_SIZE, totalBytes: bytes.length, complete: false});
    await cache.setMetadata('book', {...pdf, filename: 'current.pdf'});
  } finally {release.resolve(); await writing;}
  assert.equal((await cache.metadata('book'))?.filename, 'current.pdf'); assert.equal(await cache.verify('book', pdf), true);
});

for (const failure of ['truncated', 'overflow', 'hash', 'chunk-limit'] as const) {
  test(`invalid full PDF ${failure} never contaminates prior readable blocks`, async () => {
    const {cache, storage} = setup(), bytes = data(PDF_BLOCK_SIZE + 19), pdf = await populate(cache, bytes);
    const before = new Map([...storage.files].map(([path, value]) => [path, value.slice()]));
    const invalid = failure === 'truncated' ? bytes.slice(0, -1) : failure === 'overflow' ? new Uint8Array(bytes.length + 1) : bytes.slice();
    if (failure === 'hash') invalid[0] ^= 1;
    const chunks = failure === 'chunk-limit' ? (async function* () {yield new Uint8Array(PDF_MAX_RANGE_BYTES + 1);})() : stream(invalid);
    await assert.rejects(cache.writeComplete('book', pdf, chunks), error => (error as {code?: string}).code === 'offline_integrity_invalid');
    assert.deepEqual(storage.files, before); assert.equal(await cache.verify('book', pdf), true);
  });
}

for (const phase of ['before', 'after'] as const) {
  test(`full PDF manifest ${phase}-commit failure does not delete any published generation`, async () => {
    const {cache, storage} = setup(), bytes = data(PDF_BLOCK_SIZE + 7), pdf = await populate(cache, bytes);
    storage[phase] = (method, path) => {if (method === 'writeAtomic' && path.endsWith('/manifest.json')) throw new Error('publication interrupted');};
    await assert.rejects(cache.writeComplete('book', pdf, stream(bytes)), /publication interrupted/);
    storage[phase] = undefined;
    const restartStorage = new MemoryStorage(); restartStorage.files = storage.files;
    const restarted = new PdfBlockCache(restartStorage, 'https://api.example/account-1', () => {});
    assert.equal(await restarted.verify('book', pdf), true);
    assert.equal(!!manifestValue(storage).generation, phase === 'after');
    await restarted.setMetadata('book', pdf);
    assert.equal([...storage.files.keys()].filter(path => path.endsWith('.block')).length, 2);
  });
}

test('cancelling a staged full stream deletes only its private blocks and retains a complete previous generation', async () => {
  const {cache, storage} = setup(), bytes = data(PDF_BLOCK_SIZE + 13), pdf = descriptor(bytes), abort = new AbortController();
  await cache.setMetadata('book', pdf); await cache.writeComplete('book', pdf, stream(bytes));
  const before = new Map([...storage.files].map(([path, value]) => [path, value.slice()]));
  await assert.rejects(cache.writeComplete('book', pdf, (async function* () {yield bytes.subarray(0, PDF_BLOCK_SIZE); abort.abort(); yield bytes.subarray(PDF_BLOCK_SIZE);})(), abort.signal), {name: 'AbortError'});
  assert.deepEqual(storage.files, before); assert.equal(await cache.verify('book', pdf), true);
});

for (const operation of ['denial', 'remove', 'identity'] as const) {
  test(`${operation} proceeds during a held full PDF stream and fences its late commit`, {timeout: 3000}, async () => {
    const {cache, storage} = setup(), bytes = data(PDF_BLOCK_SIZE + 13), pdf = await populate(cache, bytes);
    const entered = deferred(), release = deferred();
    const writing = cache.writeComplete('book', pdf, (async function* () {yield bytes.subarray(0, PDF_BLOCK_SIZE); entered.resolve(); await release.promise; yield bytes.subarray(PDF_BLOCK_SIZE);})());
    const rejected = assert.rejects(writing, /revoked|identity/);
    try {
      await entered.promise;
      if (operation === 'denial') await cache.invalidate('book');
      else if (operation === 'remove') {await cache.remove('book'); await populate(cache, bytes);}
      else await cache.setMetadata('book', {...pdf, size: pdf.size + 1});
    } finally {release.resolve(); await rejected;}
    assert.equal([...storage.files.keys()].some(path => path.includes('/full-')), false);
    if (operation === 'remove') assert.equal(await cache.verify('book', pdf), true);
    else assert.equal(await cache.read('book', pdf, 0, 10), null);
  });
}

test('recovery prunes interrupted and replaced full generations only within the admitted bookmark', async () => {
  const {cache, storage} = setup(), bytes = data(PDF_BLOCK_SIZE + 7), pdf = descriptor(bytes);
  await populate(cache, bytes); await populate(cache, bytes, 'other');
  const prefix = manifestPath(storage).replace(/manifest.json$/, '');
  const orphan = `${prefix}${pdf.document_id}-${pdf.size}/full-interrupted/0.block`;
  storage.files.set(orphan, bytes.slice(0, PDF_BLOCK_SIZE));
  const previousRead = storage.list.bind(storage);
  storage.list = async prefix => [...await previousRead(prefix), `${prefix}../unrelated`, `${prefix}${pdf.document_id}-${pdf.size}/full-../0.block`];
  const restarted = new PdfBlockCache(storage, 'https://api.example/account-1', () => {});
  assert.equal(await restarted.verify('book', pdf), true);
  await restarted.writeComplete('book', pdf, stream(bytes));
  assert.equal(storage.files.has(orphan), false); assert.equal(await cache.verify('other', pdf), true);
  const first = manifestValue(storage).generation;
  await restarted.writeComplete('book', pdf, stream(bytes));
  assert.notEqual(manifestValue(storage).generation, first);
  assert.equal([...storage.files.keys()].filter(path => path.startsWith(prefix) && path.endsWith('.block')).length, 2);
  assert.equal(storage.calls.some(call => call.method === 'remove' && call.path.includes('..')), false);
});

test('concurrent metadata reads do not alter the generation of an in-progress block scan', {timeout: 3000}, async () => {
  const {cache, storage} = setup(), bytes = data(PDF_BLOCK_SIZE + 17), pdf = descriptor(bytes);
  await cache.setMetadata('book', pdf); await cache.writeComplete('book', pdf, stream(bytes));
  const entered = deferred(), release = deferred(), metadataEntered = deferred(), metadataRelease = deferred();
  let holdMetadata = false, first = true;
  storage.before = async (method, path) => {
    if (method === 'read' && path.endsWith('.block') && first) {first = false; entered.resolve(); await release.promise;}
    if (holdMetadata && method === 'read' && path.endsWith('/manifest.json')) {metadataEntered.resolve(); await metadataRelease.promise;}
  };
  const verifying = cache.verify('book', pdf); await entered.promise;
  holdMetadata = true; const reading = cache.metadata('book'); await metadataEntered.promise;
  try {release.resolve(); assert.equal(await verifying, true);} finally {metadataRelease.resolve(); await reading;}
});

test('unsafe full generation names fail closed before block I/O', async () => {
  const {cache, storage} = setup(), bytes = data(17), pdf = await populate(cache, bytes), path = manifestPath(storage), manifest = manifestValue(storage);
  for (const generation of ['../other', 'full-../../other', 'full-one/two', '', 'full-', 1, 'full-' + 'x'.repeat(101)]) {
    storage.files.set(path, encoder.encode(JSON.stringify({...manifest, generation}))); storage.calls = [];
    assert.equal(await cache.metadata('book'), null); assert.equal(await cache.read('book', pdf, 0, 3), null);
    assert.equal(storage.calls.some(call => call.path.endsWith('.block')), false);
  }
});

test('a delayed unverified range cannot overwrite an already verified complete generation', async () => {
  const {cache, storage} = setup(), bytes = data(PDF_BLOCK_SIZE + 3), pdf = descriptor(bytes);
  await cache.setMetadata('book', pdf); await cache.writeComplete('book', pdf, stream(bytes)); storage.calls = [];
  await cache.writeBlock('book', pdf, 0, new Uint8Array(PDF_BLOCK_SIZE));
  assert.equal(storage.calls.some(call => call.method === 'writeAtomic'), false);
  assert.deepEqual(await cache.read('book', pdf, 0, 11), bytes.slice(0, 11)); assert.equal(await cache.verify('book', pdf), true);
});
