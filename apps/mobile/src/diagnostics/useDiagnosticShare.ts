import {useCallback, useEffect, useRef, useState} from 'react';
import {useMobile} from '../runtime';
import {useDiagnosticSource} from './useDiagnosticLog';
import {DiagnosticExportError, shareRecentDiagnostics} from './storage';
import {throwIfAborted} from '../utils/abort';

export function useDiagnosticShare() {
  const {api, runtime, t} = useMobile(), source = useDiagnosticSource();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const flight = useRef<AbortController | null>(null), alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const owner = api.captureFeedbackOwner();
    const unsubscribe = runtime.sessions.subscribe(() => {try {owner();} catch {flight.current?.abort(); flight.current = null; setBusy(false);}});
    return () => {alive.current = false; unsubscribe(); flight.current?.abort(); flight.current = null;};
  }, [api, runtime]);
  const share = useCallback(async () => {
    if (flight.current) return;
    const controller = new AbortController(), owner = api.captureFeedbackOwner();
    flight.current = controller; setBusy(true); setError(null);
    const current = () => {throwIfAborted(controller.signal); if (!alive.current || flight.current !== controller) throw new Error('Diagnostic sharing closed'); owner();};
    try {await shareRecentDiagnostics(source, current);}
    catch (reason) {if (alive.current && !controller.signal.aborted && flight.current === controller) setError(t(reason instanceof DiagnosticExportError && reason.code === 'sharing-unavailable' ? 'diagnostic_native_share_unavailable' : 'diagnostic_error'));}
    finally {if (flight.current === controller) {flight.current = null; if (alive.current) setBusy(false);}}
  }, [api, source, t]);
  return {busy, error, share};
}
