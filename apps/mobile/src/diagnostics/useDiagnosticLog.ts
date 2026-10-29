import {useEffect, useMemo, useSyncExternalStore} from 'react';
import {useMobile} from '../runtime';
import {createDiagnosticLogController} from './controller';

export function useDiagnosticSource() {
  const {runtime} = useMobile();
  return useMemo(() => ({storage: runtime.diagnostics?.storage ?? null, flush: runtime.diagnostics?.flush}), [runtime]);
}
export function useDiagnosticLog() {
  const {t} = useMobile(), source = useDiagnosticSource();
  const controller = useMemo(() => createDiagnosticLogController(source), [source]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {void controller.open(); return () => controller.close();}, [controller]);
  return {controller, state, t};
}
