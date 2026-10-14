interface AbortStatus {readonly aborted: boolean; readonly reason?: unknown}

/** React Native's installed AbortSignal omits the newer throwIfAborted method. */
export function throwIfAborted(signal?: AbortStatus | null): void {
  if (!signal?.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  throw error;
}

/** Own the timer/listener so native runtimes need no AbortSignal.any/timeout APIs. */
export function linkedAbortTimeout(timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', abort, {once: true});
  if (parent?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  return {signal: controller.signal, cleanup() {clearTimeout(timer); parent?.removeEventListener('abort', abort);}};
}
