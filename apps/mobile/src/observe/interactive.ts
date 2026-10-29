export function createInteractiveSignal() {
  let interactive = false;
  const listeners = new Set<() => void>();
  return {
    mark() {
      if (interactive) return;
      interactive = true;
      for (const listener of listeners) {try {listener();} catch {}}
      listeners.clear();
    },
    subscribe(listener: () => void) {
      if (interactive) {try {listener();} catch {}} else listeners.add(listener);
      return () => {listeners.delete(listener);};
    },
  };
}
export const firstInteractive = createInteractiveSignal();
