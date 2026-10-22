import {fetch as expoFetch} from 'expo/fetch';
import {createMobileDataRuntime as createRuntime} from '../data/runtime';
import type {MobileDataRuntimeOptions} from '../data/runtime';
import {throwIfAborted} from '../utils/abort';
import {developmentSession} from './session';
export * from '../data/index';

const DEV_ORIGIN = '_slax_dev_api_origin_v1';

/** Development credentials enter through the normal account lifecycle, never public Expo inputs. */
export function createMobileDataRuntime(options: MobileDataRuntimeOptions) {
  const session = developmentSession;
  if (!__DEV__ || !session || options.baseUrl !== session.apiUrl || options.betaBaseUrl !== session.apiUrl) throw new Error('Development session requires its explicitly configured API origin');
  let releaseNetwork!: () => void, rejectNetwork!: (reason: unknown) => void, networkReady!: Promise<void>;
  const openNetworkGate = () => {
    networkReady = new Promise<void>((resolve, reject) => {releaseNetwork = resolve; rejectNetwork = reject;});
    void networkReady.catch(() => {});
  };
  openNetworkGate();
  async function admitted(signal?: AbortSignal | null) {
    throwIfAborted(signal ?? undefined);
    if (!signal) return networkReady;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {try {throwIfAborted(signal);} catch (error) {reject(error);}};
      signal.addEventListener('abort', abort, {once: true});
      networkReady.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
  }
  const transport: typeof globalThis.fetch = async (input, init) => {
    await admitted(init?.signal);
    throwIfAborted(init?.signal ?? undefined);
    return expoFetch(input, init);
  };
  const runtime = createRuntime({...options, fetch: transport, localSyncEndpoint: session.powerSyncUrl, freshStorage: true});
  const start = runtime.start;
  let bootstrapped = false, bootFlight: Promise<void> | undefined;
  runtime.start = () => {
    if (bootstrapped) return start();
    if (bootFlight) return bootFlight;
    bootFlight = (async () => {
      try {
        await start();
        const values = await runtime.preferences.read();
        const previousOrigin = typeof values[DEV_ORIGIN] === 'string' ? values[DEV_ORIGIN] : undefined;
        if (previousOrigin !== session.apiUrl) {
          // Local data belongs to the previous API. A development origin switch clears it
          // through the normal account lifecycle instead of migrating or adopting it.
          await runtime.sessions.signOut();
          await runtime.preferences.update(next => {next[DEV_ORIGIN] = session.apiUrl;});
        }
        await runtime.sessions.accept(session.token, session.userId);
        bootstrapped = true;
        releaseNetwork();
      } catch (error) {
        rejectNetwork(error);
        bootFlight = undefined;
        openNetworkGate();
        throw error;
      }
    })();
    return bootFlight;
  };
  return runtime;
}
