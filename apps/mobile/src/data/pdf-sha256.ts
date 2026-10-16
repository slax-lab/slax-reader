const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

export class Sha256 {
  private state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private words = new Uint32Array(64);
  private pending = new Uint8Array(64);
  private pendingBytes = 0;
  private totalBytes = 0;
  private result?: string;

  update(bytes: Uint8Array): this {
    if (this.result !== undefined) throw new Error('SHA-256 is already finalized');
    if (!Number.isSafeInteger(this.totalBytes + bytes.byteLength)) throw new Error('SHA-256 input is too large');
    this.totalBytes += bytes.byteLength;
    let offset = 0;
    if (this.pendingBytes) {
      const length = Math.min(64 - this.pendingBytes, bytes.byteLength);
      this.pending.set(bytes.subarray(0, length), this.pendingBytes);
      this.pendingBytes += length;
      offset = length;
      if (this.pendingBytes === 64) {this.compress(this.pending, 0); this.pendingBytes = 0;}
    }
    for (; offset + 64 <= bytes.byteLength; offset += 64) this.compress(bytes, offset);
    if (offset < bytes.byteLength) {
      this.pending.set(bytes.subarray(offset), this.pendingBytes);
      this.pendingBytes += bytes.byteLength - offset;
    }
    return this;
  }

  async updateAsync(bytes: Uint8Array, guard: () => void): Promise<this> {
    for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
      guard();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      guard();
      this.update(bytes.subarray(offset, offset + 64 * 1024));
    }
    guard();
    return this;
  }

  digest(): string {
    if (this.result !== undefined) return this.result;
    this.pending[this.pendingBytes++] = 0x80;
    this.pending.fill(0, this.pendingBytes);
    if (this.pendingBytes > 56) {this.compress(this.pending, 0); this.pending.fill(0);}
    const view = new DataView(this.pending.buffer);
    view.setUint32(56, Math.floor(this.totalBytes / 0x20000000), false);
    view.setUint32(60, (this.totalBytes * 8) >>> 0, false);
    this.compress(this.pending, 0);
    this.result = Array.from(this.state, value => value.toString(16).padStart(8, '0')).join('');
    return this.result;
  }

  private compress(bytes: Uint8Array, offset: number) {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + K[i] + w[i]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    this.state[0] += a; this.state[1] += b; this.state[2] += c; this.state[3] += d;
    this.state[4] += e; this.state[5] += f; this.state[6] += g; this.state[7] += h;
  }
}
