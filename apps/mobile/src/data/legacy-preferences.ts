import type { PreferenceStore, PreferenceValues, PreferenceValue } from './preferences.ts';

/** AndroidX Preferences proto decoder; original bytes are never rewritten. */
class ProtoReader {
  private bytes: Uint8Array;
  offset = 0;
  constructor(bytes: Uint8Array) { this.bytes = bytes; }
  get done() { return this.offset === this.bytes.length; }
  varint(): bigint {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = this.bytes[this.offset++];
      if (byte === undefined) throw new Error('Truncated legacy preferences');
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid legacy preference integer');
  }
  data(): Uint8Array {
    const size = Number(this.varint()), end = this.offset + size;
    if (!Number.isSafeInteger(size) || end > this.bytes.length) throw new Error('Truncated legacy preference value');
    const bytes = this.bytes.subarray(this.offset, end); this.offset = end; return bytes;
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 2) this.data();
    else if (wire === 1 || wire === 5) { this.offset += wire === 1 ? 8 : 4; if (this.offset > this.bytes.length) throw new Error('Truncated legacy preferences'); }
    else throw new Error('Unsupported legacy preference wire format');
  }
  float(size: 4 | 8): number {
    if (this.offset + size > this.bytes.length) throw new Error('Truncated legacy preferences');
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, size);
    this.offset += size; return size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
  }
}
const decodeText = (bytes: Uint8Array) => new TextDecoder('utf-8', {fatal: true}).decode(bytes);
function preferenceValue(bytes: Uint8Array): PreferenceValue {
  const reader = new ProtoReader(bytes);
  let value: PreferenceValue | undefined;
  while (!reader.done) {
    const tag = Number(reader.varint()), field = tag >>> 3, wire = tag & 7;
    if (field === 1 && wire === 0) value = reader.varint() !== 0n;
    else if (field === 2 && wire === 5) value = reader.float(4);
    else if ((field === 3 || field === 4) && wire === 0) {
      const integer = BigInt.asIntN(field === 3 ? 32 : 64, reader.varint());
      if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Legacy integer cannot be migrated losslessly');
      value = Number(integer);
    } else if (field === 5 && wire === 2) value = decodeText(reader.data());
    else if (field === 6 && wire === 2) {
      const set = new ProtoReader(reader.data()), values: string[] = [];
      while (!set.done) { const setTag = Number(set.varint()); if (setTag === 10) values.push(decodeText(set.data())); else set.skip(setTag & 7); }
      value = values;
    } else if (field === 7 && wire === 1) value = reader.float(8);
    else throw new Error('Unknown preference value; migration stopped to preserve original data');
  }
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Unsupported legacy preference value');
  return value;
}
export function decodeLegacyPreferences(bytes: Uint8Array): PreferenceValues {
  const reader = new ProtoReader(bytes), values: PreferenceValues = {};
  while (!reader.done) {
    const tag = Number(reader.varint());
    if (tag !== 10) { reader.skip(tag & 7); continue; }
    const entry = new ProtoReader(reader.data());
    let key: string | undefined, value: PreferenceValue | undefined;
    while (!entry.done) {
      const field = Number(entry.varint());
      if (field === 10) key = decodeText(entry.data());
      else if (field === 18) value = preferenceValue(entry.data());
      else entry.skip(field & 7);
    }
    if (!key || value === undefined) throw new Error('Incomplete legacy preference entry');
    Object.defineProperty(values, key, {value, enumerable: true, writable: true, configurable: true});
  }
  return values;
}
export interface LegacyPreferenceSource { readLegacyPreferences(): Promise<{bytes: number[]; fingerprint: string} | null> }
export async function migrateLegacyPreferences(store: PreferenceStore, source: LegacyPreferenceSource, snapshot?: PreferenceValues): Promise<'migrated' | 'already-migrated' | 'new-install'> {
  const key = '_slax_preferences_migration_v1';
  if ((snapshot ?? await store.read())[key]) return 'already-migrated';
  const legacy = await source.readLegacyPreferences();
  const values = legacy ? decodeLegacyPreferences(new Uint8Array(legacy.bytes)) : {};
  await store.update(next => {
    if (next[key]) return;
    for (const [name, value] of Object.entries(values)) if (!(name in next)) next[name] = value;
    next[key] = legacy?.fingerprint ?? 'new-install';
  });
  return legacy ? 'migrated' : 'new-install';
}
