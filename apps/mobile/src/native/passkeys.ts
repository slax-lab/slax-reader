import {requireNativeModule} from 'expo';
import type {NativePasskeys} from '../auth/passkeys';
import {throwIfAborted} from '../utils/abort';

interface PasskeyModule {
  createPasskey(options: string): Promise<string | null>;
  authenticatePasskey(options: string): Promise<string | null>;
  cancelPasskey(): Promise<void>;
}

async function ceremony<T>(method: 'createPasskey' | 'authenticatePasskey', options: unknown, signal: AbortSignal): Promise<T | null> {
  throwIfAborted(signal);
  const platform = requireNativeModule<PasskeyModule>('SlaxPlatform');
  const cancel = () => {void platform.cancelPasskey();};
  signal.addEventListener('abort', cancel, {once: true});
  try {
    const result = await platform[method](JSON.stringify(options));
    throwIfAborted(signal);
    return result === null ? null : JSON.parse(result) as T;
  } finally {signal.removeEventListener('abort', cancel);}
}

export const nativePasskeys: NativePasskeys = {
  register: (options, signal) => ceremony('createPasskey', options, signal),
  authenticate: (options, signal) => ceremony('authenticatePasskey', options, signal),
};
