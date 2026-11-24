import {createErrorCollector, type ErrorCollector} from '@commons/frontend-utils/errorLog';
import type {MobileErrorLog} from '../domain/error-log.ts';
import type {PreferenceStore} from '../data/preferences.ts';
import type {SessionController} from '../domain/session.ts';

export interface MobileErrorLogOptions {
  endpoint?: string;
  platform: 'ios' | 'android';
  version: string;
  buildNumber: string;
  env(): 'development' | 'beta' | 'production';
  preferences: PreferenceStore;
  sessions: SessionController;
  screen(): string | undefined;
  generateIdentifier(): string;
}

/** Builds the shared collector for one environment; the collector is recreated if the runtime environment changes. */
export function createMobileErrorLog(options: MobileErrorLogOptions): MobileErrorLog {
  const endpoint = options.endpoint?.trim();
  let cached: {env: string; collector: ErrorCollector} | undefined;
  let deviceId: string | undefined;
  try {
    void options.preferences.deviceId(options.generateIdentifier).then(id => {deviceId = id;}).catch(() => undefined);
  } catch {}
  const collector = () => {
    const env = options.env();
    if (cached?.env !== env) {
      cached = {
        env,
        collector: createErrorCollector({
          endpoint,
          app: options.platform,
          release: `${options.version}+${options.buildNumber}`,
          env,
          pageUrl: () => undefined,
          getContext: () => {
            const session = options.sessions.getSnapshot();
            return {
              userId: session.status === 'authenticated' ? session.session.userId : undefined,
              deviceId
            };
          },
          send: async (_endpoint: string, body: string) => {
            await fetch(_endpoint, {method: 'POST', headers: {'Content-Type': 'text/plain'}, body});
          }
        })
      };
    }
    return cached.collector;
  };
  return {
    capture(kind, error, properties = {}) {
      try {
        const screen = options.screen();
        return collector().capture(kind, error, {...(screen ? {screen} : {}), ...properties});
      } catch {
        return undefined;
      }
    },
    async flush(hiding = false) {
      try {
        await collector().flush(hiding);
      } catch {}
    }
  };
}
