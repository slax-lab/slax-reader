import type {SlaxApi} from '../data/api.ts';
import {SessionChangedError, type SessionController} from './session.ts';
import {throwIfAborted} from '../utils/abort.ts';

/** Keep both the deletion and its successful sign-out bound to the initiating session. */
export async function deleteCurrentAccount(options: {
  api: Pick<SlaxApi, 'deleteAccount'>;
  sessions: Pick<SessionController, 'captureRequestScope' | 'clearIfMatches'>;
  signal: AbortSignal;
  isActive(): boolean;
}): ReturnType<SlaxApi['deleteAccount']> {
  const scope = options.sessions.captureRequestScope();
  const assertActive = () => {
    throwIfAborted(options.signal);
    scope.assertCurrent();
    if (!options.isActive()) throw new SessionChangedError();
  };
  assertActive();
  const session = await scope.getSession();
  assertActive();
  if (!session) throw new SessionChangedError();
  const result = await options.api.deleteAccount(options.signal).catch(error => {assertActive(); throw error;});
  assertActive();
  if (result.canDelete) await options.sessions.clearIfMatches(session.token, scope);
  return result;
}
