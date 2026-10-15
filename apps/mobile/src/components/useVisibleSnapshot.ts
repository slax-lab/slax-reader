import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

export function useVisibleSnapshot<T>(owner: unknown, initial: T, visible: boolean): [T, (value: T) => void] {
  const scope = useMemo(() => ({latest: initial, active: true}), [owner]);
  const current = useRef(scope); current.current = scope;
  const showing = useRef(visible); showing.current = visible;
  const [published, publish] = useState({scope, value: initial});
  const update = useCallback((value: T) => {
    if (!scope.active || current.current !== scope) return;
    scope.latest = value;
    if (showing.current) publish(previous => previous.scope === scope && Object.is(previous.value, value) ? previous : {scope, value});
  }, [scope]);
  useEffect(() => {scope.active = true; return () => {scope.active = false;};}, [scope]);
  useEffect(() => {if (visible) update(scope.latest);}, [visible, scope, update]);
  return [published.scope === scope ? published.value : initial, update];
}
