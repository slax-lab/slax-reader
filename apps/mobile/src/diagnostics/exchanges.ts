import {recordDiagnostic, type DiagnosticExchange, type DiagnosticSink} from '../domain/diagnostics.ts';
import {redactError} from './redact.ts';

const deletionReasons = new Set(['active_subscription', 'stripe_connect_exists', 'collection_has_subscribers', 'active_collection_subscription', 'has_free_subscription_history']);
export function createAccountDiagnostics(sink: DiagnosticSink, captureEpoch: () => () => void = () => () => {}) {
  let refreshStreak: (() => void) | undefined;
  return {
    failed(exchange: DiagnosticExchange) {
      const {http, headers, durationMs, provider} = exchange;
      if (http.path === '/v1/user/login' && provider) recordDiagnostic(sink, 'auth.login', {provider, ok: false, http, headers, durationMs});
      else if (http.path === '/v1/user/refresh') {
        try {refreshStreak?.();} catch {refreshStreak = undefined;}
        if (refreshStreak) return;
        refreshStreak = captureEpoch();
        recordDiagnostic(sink, 'auth.refresh_failed', {http, error: redactError(exchange.error)});
      } else if (http.path === '/v1/user/delete_my_account') recordDiagnostic(sink, 'account.delete', {ok: false, canDelete: null, reason: null, http});
    },
    succeeded(exchange: DiagnosticExchange) {
      const {http, headers, durationMs, provider} = exchange;
      if (http.path === '/v1/user/refresh') refreshStreak = undefined;
      else if (http.path === '/v1/user/login' && provider) recordDiagnostic(sink, 'auth.login', {provider, ok: true, http, headers, durationMs});
      else if (http.path === '/v1/user/delete_my_account') recordDiagnostic(sink, 'account.delete', {ok: true, canDelete: exchange.canDelete ?? null, reason: exchange.reason && deletionReasons.has(exchange.reason) ? exchange.reason : null, http});
    },
  };
}
