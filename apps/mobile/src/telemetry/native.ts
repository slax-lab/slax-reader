import type {MobileErrorLog} from '../domain/error-log.ts';
import {noopErrorLog} from '../domain/error-log.ts';

let active: MobileErrorLog = noopErrorLog;
let installed = false;

/** Installed by the provider once the runtime exists; earlier failures have no report path. */
export function setActiveErrorLog(log: MobileErrorLog) {
  active = log;
}

const report = (kind: 'error' | 'unhandledrejection' | 'render', error: unknown) => {
  try {
    active.capture(kind, error);
  } catch {}
};

export function reportRenderError(error: unknown) {
  report('render', error);
}

type ErrorUtilsShape = {
  getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

type HermesShape = {
  enablePromiseRejectionTracker?: (options: {allRejections: boolean; onUnhandled: (id: number, reason: unknown) => void; onHandled: (id: number) => void}) => void;
};

/** Chains the existing React Native handlers; development keeps RN's own rejection tracking. */
export function installNativeErrorHandlers() {
  if (installed) return;
  installed = true;
  try {
    const errorUtils = (globalThis as typeof globalThis & {ErrorUtils?: ErrorUtilsShape}).ErrorUtils;
    if (errorUtils?.setGlobalHandler) {
      const previous = errorUtils.getGlobalHandler?.();
      errorUtils.setGlobalHandler((error, isFatal) => {
        report('error', error);
        previous?.(error, isFatal);
      });
    }
  } catch {}
  if (!__DEV__) {
    try {
      const hermes = (globalThis as typeof globalThis & {HermesInternal?: HermesShape}).HermesInternal;
      hermes?.enablePromiseRejectionTracker?.({
        allRejections: true,
        onUnhandled: (_id, reason) => report('unhandledrejection', reason),
        onHandled: () => undefined
      });
    } catch {}
  }
}
