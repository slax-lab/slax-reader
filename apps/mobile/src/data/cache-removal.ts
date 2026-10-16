export interface CacheRemovalFiles {
  stage(key: string, generation: string, signal: AbortSignal): Promise<void>;
  restore(key: string, generation: string): Promise<void>;
  purge(key: string, generation: string): Promise<void>;
}
