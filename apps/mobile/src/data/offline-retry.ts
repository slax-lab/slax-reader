import type {OfflineImageState} from './repositories/offline-manifests.ts';

export type OfflineRetryState = {state: 'failed' | 'denied'; attempts: number; retryAt: number};
export function offlineFailure(previousAttempts: number, error: unknown, now: number, random = Math.random): OfflineRetryState {
  const fields = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const status = Number(fields.status ?? 0);
  const denied = status >= 400 && status < 500 && ![408, 429].includes(status) || fields.kind === 'protocol' || fields.name === 'ReauthenticationRequiredError' || fields.code === 'offline_integrity_invalid';
  const attempts = Math.min(previousAttempts + 1, 30);
  const delay = Math.min(300_000, 5000 * 2 ** Math.min(attempts - 1, 6));
  const value = random(), jitter = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  const retryAfter = Number(fields.retryAfterMs ?? 0);
  const retryAt = Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(now + Math.max(delay * (0.8 + jitter * 0.2), Number.isFinite(retryAfter) ? Math.max(0, retryAfter) : 0)));
  return {state: denied ? 'denied' : 'failed', attempts, retryAt: denied ? 0 : retryAt};
}

export function imageFailure(previous: OfflineImageState, error: unknown, now: number, random = Math.random): OfflineImageState {
  return {...previous, ...offlineFailure(previous.attempts, error, now, random)};
}
