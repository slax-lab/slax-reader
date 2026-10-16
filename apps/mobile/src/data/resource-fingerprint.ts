export type ResourceFingerprint = {size: number; sha256: string};
export function validResourceFingerprint(value: unknown): value is ResourceFingerprint {
  if (!value || typeof value !== 'object') return false;
  const fingerprint = value as ResourceFingerprint;
  return Number.isSafeInteger(fingerprint.size) && fingerprint.size >= 0 && fingerprint.size <= 20 * 1024 * 1024 &&
    typeof fingerprint.sha256 === 'string' && /^[a-f0-9]{64}$/.test(fingerprint.sha256);
}
