import {useCallback, useEffect, useRef, useState} from 'react';
import {useMobile} from '../runtime';
import {useTelemetry} from '../telemetry';
import type {MobileScreenProps} from '../navigation/types';
import {useDiagnosticSource} from '../diagnostics/useDiagnosticLog';
import {DiagnosticExportError, stageRecentDiagnostics, type DiagnosticExport} from '../diagnostics/storage';
import {throwIfAborted} from '../utils/abort';

export function useFeedback(params: MobileScreenProps<'Feedback'>['route']['params']) {
  const {t, repositories, api, runtime, config, fixtureOnly} = useMobile(), telemetry = useTelemetry(), diagnostics = useDiagnosticSource();
  const [content, setContent] = useState(''), [followUp, setFollowUp] = useState(true), [attachLogs, setAttachLogs] = useState(false);
  const [busy, setBusy] = useState(false), [ownerChanged, setOwnerChanged] = useState(false);
  const [user, setUser] = useState<Record<string, unknown>>({}), [title, setTitle] = useState(params?.title ?? '');
  const [result, setResult] = useState<{ok: boolean; message?: string} | null>(null);
  const request = useRef<AbortController | null>(null), alive = useRef(false), translate = useRef(t);
  translate.current = t;
  useEffect(() => repositories?.watchUser(rows => setUser(rows[0] ?? {})), [repositories]);
  useEffect(() => {
    let active = true; setTitle(params?.title ?? '');
    if (!params?.title && params?.bookmarkId) void repositories?.getBookmark(params.bookmarkId).then(value => {if (active) setTitle(value?.aliasTitle || value?.title || '');}).catch(() => {if (active) setTitle('');});
    return () => {active = false;};
  }, [repositories, params?.bookmarkId, params?.title]);
  useEffect(() => {
    alive.current = true; setBusy(false);
    const owner = api.captureFeedbackOwner();
    const unsubscribe = runtime.sessions.subscribe(() => {
      try {owner();} catch {request.current?.abort(); request.current = null; setBusy(false); setOwnerChanged(true); setResult({ok: false, message: translate.current('feedback_owner_changed')});}
    });
    return () => {alive.current = false; unsubscribe(); request.current?.abort(); request.current = null;};
  }, [api, runtime]);
  const cancel = useCallback(() => {request.current?.abort(); request.current = null; if (alive.current) setBusy(false);}, []);
  const submit = useCallback(async () => {
    if (!content.trim() || request.current || ownerChanged) return;
    const controller = new AbortController(), owner = api.captureFeedbackOwner();
    const current = () => {throwIfAborted(controller.signal); if (!alive.current || request.current !== controller) throw new Error('Feedback closed'); owner();};
    request.current = controller; setBusy(true); setResult(null);
    let exported: DiagnosticExport | undefined;
    try {
      current();
      if (attachLogs) exported = await stageRecentDiagnostics(diagnostics, current);
      current();
      await api.sendFeedback({bookmark_uuid: params?.bookmarkId ?? '', entry_point: params?.entryPoint ?? '', type: 'parse_error', content: content.trim(), platform: 'app', environment: `${config.platform === 'ios' ? 'iOS' : 'Android'} ${config.buildNumber}`, version: `${config.version} (${config.buildNumber})`, allow_follow_up: followUp, target_url: params?.targetUrl ?? ''}, controller.signal, exported);
      current();
      telemetry.firebase('feedback', 'submit_start', {scope: 'app'});
      setContent(''); setAttachLogs(false); setResult({ok: true});
    } catch (error) {
      if (alive.current && request.current === controller && !controller.signal.aborted) {
        setResult({ok: false, message: translate.current(error instanceof DiagnosticExportError && error.code === 'too-large' ? 'feedback_logs_too_large' : attachLogs ? 'feedback_logs_failed' : 'feedback_retry_message')});
      }
    } finally {
      exported?.release();
      if (request.current === controller) {request.current = null; if (alive.current) setBusy(false);}
    }
  }, [api, attachLogs, config, content, diagnostics, followUp, ownerChanged, params, telemetry]);
  return {t, fixtureOnly, content, setContent, followUp, setFollowUp, attachLogs, setAttachLogs, busy, ownerChanged, user, title, result, setResult, submit, cancel};
}
