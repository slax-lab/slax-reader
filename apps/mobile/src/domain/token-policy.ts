export const MAIN_REFRESH_INTERVAL_SECONDS = 86400;
export const TOKEN_EXPIRY_SKEW_MS = 60000;
export const SYNC_MAX_LIFETIME_MS = 86400000;
export const SYNC_EXPECTED_LIFETIME_SECONDS = 86399;
export interface JwtTiming {exp: number; iat?: number; sub?: string}
export function jwtTiming(token: string): JwtTiming | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every(part => part.length > 0) || parts[1].length > 16384 || !/^[\w-]+$/.test(parts[1])) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const value: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, character => character.charCodeAt(0))));
    if (!value || typeof value !== 'object' || !('exp' in value) || typeof value.exp !== 'number' || !Number.isSafeInteger(value.exp) || value.exp <= 0) return null;
    const claims = value as JwtTiming;
    if (claims.iat !== undefined && (!Number.isSafeInteger(claims.iat) || claims.iat < 0 || claims.iat >= claims.exp)) return null;
    return {exp: claims.exp, ...(claims.iat === undefined ? {} : {iat: claims.iat}), ...(typeof claims.sub === 'string' ? {sub: claims.sub} : {})};
  } catch {return null;}
}
export function mainRefreshAt(session: {token: string; refreshedAt: number}, nowSeconds: number): number {
  if (!Number.isFinite(session.refreshedAt) || session.refreshedAt <= 0 || session.refreshedAt > nowSeconds) return nowSeconds;
  const timing = jwtTiming(session.token);
  return Math.min(session.refreshedAt + MAIN_REFRESH_INTERVAL_SECONDS, timing ? timing.exp - TOKEN_EXPIRY_SKEW_MS / 1000 : Infinity);
}
export function syncTokenExpiresAt(token: string, _userId: string, fetchedAt: number, now: number): Date | null {
  const timing = jwtTiming(token);
  if (!timing || !Number.isFinite(fetchedAt) || fetchedAt < 0 || fetchedAt > now ||
    (timing.iat !== undefined && timing.iat * 1000 > now + TOKEN_EXPIRY_SKEW_MS)) return null;
  const expiration = Math.min(timing.exp * 1000, fetchedAt + SYNC_MAX_LIFETIME_MS);
  if (!Number.isSafeInteger(expiration) || expiration <= now + TOKEN_EXPIRY_SKEW_MS) return null;
  return new Date(expiration);
}
