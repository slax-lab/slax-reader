import {useCallback, useEffect, useRef, useState} from 'react';
import type {SlaxApi} from '../data/api';
import {deleteCurrentAccount} from '../domain/delete-account';
import {SessionChangedError, type SessionController} from '../domain/session';
import type {AccountScope} from './account-scope';
import type {NoticeReadGate} from './notice-read-gate';

const deletionReasons: Record<string, string> = {
  active_subscription: '无法删除账号：您有正在进行的订阅，请先取消订阅后再试',
  stripe_connect_exists: '无法删除账号：您的账号关联了 Stripe Connect，请先解除关联',
  collection_has_subscribers: '无法删除账号：您的合集有订阅者，请先处理相关合集',
  active_collection_subscription: '无法删除账号：您订阅了某些合集，请先取消订阅',
  has_free_subscription_history: '无法删除账号：您有免费订阅记录，请联系客服处理',
};

export interface DeleteAccountState {
  busy: boolean;
  confirm: boolean;
  error: string | null;
  canDelete: boolean;
  askConfirmation(): void;
  dismissConfirmation(): void;
  dismissError(): void;
  remove(): Promise<void>;
}

export function useDeleteAccountState({api, sessions, scope, gate, read}: {
  api: Pick<SlaxApi, 'deleteAccount'>;
  sessions: Pick<SessionController, 'captureRequestScope' | 'clearIfMatches' | 'captureIdentity'>;
  scope: AccountScope;
  gate: NoticeReadGate;
  read: boolean;
}): DeleteAccountState {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const lifetime = useRef<object | null>(null);
  const confirmation = useRef(false);
  const [assertIdentity] = useState(() => sessions.captureIdentity());
  const admitted = useRef<AccountScope | null>(scope.isCurrent() ? scope : null);
  const activeAccount = () => {
    try { assertIdentity(); } catch { return false; }
    return scope.isCurrent() && (admitted.current === null || admitted.current === scope);
  };
  const dismissConfirmation = useCallback(() => {
    confirmation.current = false;
    setConfirm(false);
  }, []);

  useEffect(() => {
    const generation = {};
    lifetime.current = generation;
    if (scope.isCurrent()) admitted.current ??= scope;
    dismissConfirmation();
    setBusy(false);
    setError(null);
    return () => {
      lifetime.current = null;
      confirmation.current = false;
      request.current?.abort();
      request.current = null;
    };
  }, [api, sessions, scope, gate, dismissConfirmation]);
  useEffect(() => {
    if (!read) dismissConfirmation();
  }, [read, dismissConfirmation]);

  const accountActive = activeAccount();
  const allowed = () => lifetime.current !== null && activeAccount() && gate.canDelete && !request.current;
  async function remove() {
    if (!confirmation.current || !allowed()) return;
    const generation = lifetime.current;
    const isActive = () => lifetime.current === generation && activeAccount();
    dismissConfirmation();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const response = await deleteCurrentAccount({api, sessions, signal: controller.signal, isActive});
      if (controller.signal.aborted || !isActive()) return;
      if (!response?.canDelete) setError(deletionReasons[String(response?.reason)] ?? '无法删除账号，原因未知');
    } catch (reason) {
      if (!controller.signal.aborted && !(reason instanceof SessionChangedError) && isActive()) {
        setError(reason instanceof Error ? reason.message : '删除账号时发生未知错误');
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted && isActive()) setBusy(false);
      }
    }
  }

  return {
    busy,
    confirm: confirm && read && accountActive,
    error,
    canDelete: read && accountActive && !busy,
    askConfirmation() {
      if (!allowed()) return;
      confirmation.current = true;
      setConfirm(true);
    },
    dismissConfirmation,
    dismissError: () => setError(null),
    remove,
  };
}
