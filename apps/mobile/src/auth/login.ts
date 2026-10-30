import {recordDiagnostic, type DiagnosticSink} from '../domain/diagnostics.ts';
import type {LoginRequest, LoginResponse, SlaxApi} from '../data/api.ts';

export async function loginWithProvider(options: {provider: 'google' | 'apple'; authenticate(): Promise<LoginRequest | null>; isCurrent(): boolean; api: Pick<SlaxApi, 'login'> & Partial<Pick<SlaxApi, 'getFailedExchange'>>; diagnostics?: DiagnosticSink; now?: () => number}): Promise<LoginResponse | null> {
  const now = options.now ?? Date.now, started = now();
  try {
    const request = await options.authenticate();
    if (!request || !options.isCurrent()) return null;
    return await options.api.login(request);
  } catch (error) {
    if (!options.api.getFailedExchange?.(error) && options.isCurrent()) recordDiagnostic(options.diagnostics, 'auth.login', {provider: options.provider, ok: false, http: null, durationMs: Math.max(0, now() - started), headers: {request: {}, response: {}}});
    throw error;
  }
}
