import {useEffect, useMemo} from 'react';
import type {SessionController, SessionState} from '../domain/session';

export interface AccountScopeInput {
  sessions: Pick<SessionController, 'getSnapshot' | 'captureIdentity'>;
  session: SessionState;
  runtime: {getNativeResourceOwner(): string | null};
  nativeResourceOwner: string | null;
  apiOrigin: string;
  fixture?: boolean;
}

export interface AccountScope {
  isCurrent(): boolean;
}

export function useAccountScope({
  sessions, session, runtime, nativeResourceOwner, apiOrigin, fixture = false,
}: AccountScopeInput): AccountScope {
  const userId = session.status === 'authenticated' ? session.session.userId : null;
  const scope = useMemo(() => {
    const assertIdentity = sessions.captureIdentity();
    return {
      disposed: false,
      isCurrent() {
        try { assertIdentity(); } catch { return false; }
        const current = sessions.getSnapshot();
        return !this.disposed && userId !== null && current.status === 'authenticated'
          && current.session.userId === userId
          && (fixture || nativeResourceOwner !== null
            && runtime.getNativeResourceOwner() === nativeResourceOwner);
      },
    };
  }, [sessions, runtime, userId, nativeResourceOwner, apiOrigin, fixture]);
  useEffect(() => {
    scope.disposed = false;
    return () => { scope.disposed = true; };
  }, [scope]);
  return scope;
}
