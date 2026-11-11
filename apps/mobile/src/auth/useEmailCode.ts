import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {EmailCodeChallenge, EmailCodeInput} from '@slax-reader/contracts/email-auth';
import type {SendEmailCode} from '../data/api';
import type {AppMessageKey, MobileLocale} from '../i18n';
import {emailAuthError} from './email-auth-errors';

export interface EmailCodeOptions<T> {
  locale: MobileLocale;
  isCurrent(): boolean;
  send(body: SendEmailCode, signal: AbortSignal): Promise<EmailCodeChallenge>;
  verify(body: EmailCodeInput, signal: AbortSignal): Promise<T>;
  onVerified(result: T, signal: AbortSignal): void | Promise<void>;
}

export function useEmailCode<T>({locale, isCurrent, send, verify, onVerified}: EmailCodeOptions<T>) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<{email: string; id: string; expiresAt: number; resendAt: number} | null>(null);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<AppMessageKey>();
  const [spent, setSpent] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false; pending.current?.abort();};
  }, []);

  useEffect(() => {
    if (!challenge || now >= Math.max(challenge.expiresAt, challenge.resendAt)) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [challenge, now]);

  const resendSeconds = challenge ? Math.max(0, Math.ceil((challenge.resendAt - now) / 1000)) : 0;
  const expired = challenge !== null && challenge.expiresAt <= now;
  const address = email.trim();
  const canSend = !busy && resendSeconds === 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  const canEditCode = !busy && !expired && !spent;
  const canVerify = canEditCode && challenge !== null && code.length === 6;

  async function run(action: 'send' | 'verify', task: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (pending.current || !mounted.current || !isCurrent()) return;
    const request = new AbortController();
    pending.current = request;
    const current = () => mounted.current && !request.signal.aborted && isCurrent();
    setBusy(action);
    setError(undefined);
    try {
      await task(request.signal, current);
    } catch (reason) {
      if (!current()) return;
      const key = emailAuthError(reason);
      if (key === 'email_auth_attempts' || key === 'email_auth_existing_account' || key === 'email_auth_conflict') setSpent(true);
      setError(key ?? (action === 'send' ? 'email_auth_send_failed' : 'email_auth_verify_failed'));
    } finally {
      if (pending.current === request) pending.current = null;
      if (current()) setBusy(null);
    }
  }

  function sendCode() {
    if (!canSend || (challenge && challenge.resendAt > Date.now())) return;
    void run('send', async (signal, current) => {
      const result = await send({email: address, locale}, signal);
      if (!current()) return;
      const receivedAt = Date.now();
      setNow(receivedAt);
      setChallenge({email: address, id: result.request_id, expiresAt: receivedAt + result.expires_in * 1000, resendAt: receivedAt + result.resend_after * 1000});
      setCode('');
      setSpent(false);
    });
  }

  function verifyCode() {
    if (!canVerify || !challenge) return;
    if (challenge.expiresAt <= Date.now()) {
      setNow(Date.now());
      return;
    }
    void run('verify', async (signal, current) => {
      const result = await verify({email: challenge.email, request_id: challenge.id, code}, signal);
      if (!current()) return;
      setSpent(true);
      await onVerified(result, signal);
    });
  }

  function changeEmail() {
    if (pending.current) return;
    setChallenge(null);
    setCode('');
    setError(undefined);
  }

  return {
    email, code, sentTo: challenge?.email, busy, error, expired, resendSeconds, canSend, canEditCode, canVerify,
    sendCode, verifyCode, changeEmail, cancel: () => pending.current?.abort(),
    changeAddress: (value: string) => {setEmail(value); setError(undefined);},
    changeCode: (value: string) => {setCode(value.replace(/[^0-9]/g, '').slice(0, 6)); setError(undefined);},
  };
}
