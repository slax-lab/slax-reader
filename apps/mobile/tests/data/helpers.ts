import type {PreferenceStorage, PreferenceValues} from '../../src/data/preferences.ts';
export const testJwt = (sub: string, exp = 86402, iat = 2) => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({sub, exp, iat})).toString('base64url')}.synthetic`;
export class MemoryPreferences implements PreferenceStorage {
  revision = 0;
  values: PreferenceValues;
  beforeSwap?: () => void;
  constructor(values: PreferenceValues = {}) { this.values = structuredClone(values); }
  async read() { return {revision: this.revision, values: structuredClone(this.values)}; }
  async compareAndSwap(revision: number, values: PreferenceValues) {
    this.beforeSwap?.();
    if (revision !== this.revision) return false;
    this.values = structuredClone(values); this.revision++; return true;
  }
}
