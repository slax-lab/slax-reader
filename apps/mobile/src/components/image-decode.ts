type Pending = {run(): Promise<void>; cancel(): void};
const pending: Pending[] = [];
let active = 0;
function pump() {
  while (active < 2 && pending.length) {
    const job = pending.shift()!; active++;
    void job.run().finally(() => {active--; pump();});
  }
}
export function decodeImage<T extends {release(): void}>(load: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abortError = () => Object.assign(new Error('Image decode cancelled'), {name: 'AbortError'});
    let cancelled = false, running = false;
    const job: Pending = {
      async run() {
        running = true;
        try {
          if (cancelled) return;
          const result = await load();
          if (cancelled) result.release(); else resolve(result);
        } catch (error) {if (!cancelled) reject(error);}
        finally {signal.removeEventListener('abort', job.cancel);}
      },
      cancel() {
        if (cancelled) return;
        cancelled = true; reject(abortError());
        if (!running) {
          const index = pending.indexOf(job); if (index >= 0) pending.splice(index, 1);
          signal.removeEventListener('abort', job.cancel);
        }
      },
    };
    if (signal.aborted) {job.cancel(); return;}
    if (pending.length >= 128) {reject(new Error('Image decode queue is full')); return;}
    signal.addEventListener('abort', job.cancel, {once: true}); pending.push(job); pump();
  });
}
