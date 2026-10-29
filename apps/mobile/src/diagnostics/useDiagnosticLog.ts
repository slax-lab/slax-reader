import {useEffect, useMemo, useSyncExternalStore} from 'react';
import {Platform} from 'react-native';
import {useMobile} from '../runtime';
import {createDiagnosticLogController} from './controller';
import {readDiagnosticSnapshot} from './snapshot';

export function useDiagnosticSource() {
  const {runtime, config, fixtureOnly} = useMobile();
  return useMemo(() => ({storage: runtime.diagnostics?.storage ?? null, flush: runtime.diagnostics?.flush,
    async snapshot() {
      const preferences = await runtime.preferences.read();
      return readDiagnosticSnapshot({database: () => runtime.getDatabase(), session: runtime.sessions.getSnapshot,
        reauthentication: () => runtime.credentials?.getSnapshot().status ?? 'unknown', network: () => fixtureOnly?.network ?? runtime.getNetworkSnapshot?.() ?? 'unknown',
        environment: () => preferences.selected_env === 'PRODUCTION' || preferences.selected_env === 'BETA' ? preferences.selected_env : 'default',
        version: config.version, build: String(config.buildNumber), os: Platform.OS === 'android' ? `Android ${Platform.constants.Release}` : `iOS ${Platform.Version}`,
      }, runtime.diagnostics?.storage?.shareAvailable ?? false);
    },
  }), [runtime, config.version, config.buildNumber, fixtureOnly]);
}
export function useDiagnosticLog() {
  const {t} = useMobile(), source = useDiagnosticSource();
  const controller = useMemo(() => createDiagnosticLogController(source), [source]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {void controller.open(); return () => controller.close();}, [controller]);
  return {controller, state, t};
}
