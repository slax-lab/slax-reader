import {useLayoutEffect, useRef, useState} from 'react';
import type {EmailCodeInput} from '@slax-reader/contracts/email-auth';
import type {LoginResponse, SlaxApi} from '../data/api';
import {loginWithPasskey, type NativePasskeys} from './passkeys';
import type {SessionController} from '../domain/session';

interface EmailLoginAttempt {
  isCurrent(): boolean;
  adoptSessionGuard(assertCurrent: () => void): void;
  committing: boolean;
}

interface EmailLoginOptions {
  api: Pick<SlaxApi, 'sendLoginEmail' | 'verifyLoginEmail' | 'getPasskeyLoginChallenge' | 'loginPasskey'>;
  nativePasskeys: NativePasskeys;
  sessions: Pick<SessionController, 'accept'>;
  apiOrigin: string;
  onOpen(): void;
  onVerify(): void;
  onPasskey(): void;
  onAuthenticated?(): void;
}

export function useEmailLogin({api, sessions, nativePasskeys, apiOrigin, onOpen, onVerify, onPasskey, onAuthenticated}: EmailLoginOptions) {
  const active = useRef<EmailLoginAttempt | null>(null);
  const [flow, setFlow] = useState<EmailLoginAttempt | null>(null);
  const [committing, setCommitting] = useState(false);

  useLayoutEffect(() => {
    setFlow(null);
    setCommitting(false);
    return () => {active.current = null;};
  }, [api, sessions, apiOrigin]);

  function open(allowed: () => boolean) {
    if (active.current || !allowed()) return;
    let isCurrentSession = allowed;
    const attempt: EmailLoginAttempt = {
      isCurrent: () => active.current === attempt && isCurrentSession(),
      adoptSessionGuard(assertCurrent) {
        isCurrentSession = () => {try {assertCurrent(); return true;} catch {return false;}};
      },
      committing: false,
    };
    active.current = attempt;
    onOpen();
    setFlow(attempt);
  }

  function retire() {
    active.current = null;
    setFlow(null);
    setCommitting(false);
  }

  function close() {
    if (!flow || active.current !== flow) return;
    if (flow.committing) return false;
    retire();
  }

  function verify(body: EmailCodeInput, signal: AbortSignal) {
    onVerify();
    return api.verifyLoginEmail(body, signal);
  }

  async function accept(result: LoginResponse, signal: AbortSignal) {
    if (!flow?.isCurrent()) return;
    try {
      await sessions.accept(result.token, result.user_id, assertCurrent => {
        flow.adoptSessionGuard(assertCurrent);
        flow.committing = true;
        setCommitting(true);
      }, signal);
      if (!flow.isCurrent() || signal.aborted) return;
      retire();
      onAuthenticated?.();
    } finally {
      if (flow.isCurrent()) {
        flow.committing = false;
        setCommitting(false);
      }
    }
  }

  const passkey = (email: string, signal: AbortSignal) => {
    onPasskey();
    return loginWithPasskey({api, native: nativePasskeys, email, signal, isCurrent: () => Boolean(flow?.isCurrent())});
  };
  return {flow, passkey, dismissible: !committing, open, close, send: api.sendLoginEmail, verify, accept};
}
