export interface BookmarkSaveState {
  id: string;
  status: string;
  updated_at: string;
}

const processing = new Set(["pending", "pending_retry", "parseing"]);

/** UI re-entry protection; the server remains authoritative while sync catches up. */
export function createBookmarkSaveGuard() {
  const running = new Set<string>();
  return {
    async run(
      account: string,
      url: string,
      read: () => Promise<BookmarkSaveState | null>,
      save: () => Promise<unknown>
    ): Promise<boolean> {
      const key = JSON.stringify([account, url]);
      if (running.has(key)) return false;
      running.add(key);
      try {
        const row = await read();
        if (row && processing.has(row.status)) return false;
        await save();
        return true;
      } finally {
        running.delete(key);
      }
    },
  };
}
