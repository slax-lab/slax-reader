import { createBookmarkSaveGuard } from "./bookmarkSaveGuard";

const guards = new WeakMap<
  object,
  ReturnType<typeof createBookmarkSaveGuard>
>();

export function bookmarkSaveGuardFor(store: object) {
  let guard = guards.get(store);
  if (!guard) guards.set(store, (guard = createBookmarkSaveGuard()));
  return guard;
}
