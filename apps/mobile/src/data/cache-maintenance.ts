import type {SqlDatabase} from './repositories.ts';

export const cacheCategories = ['article', 'images', 'other'] as const;
export type CacheCategory = typeof cacheCategories[number];
export type CacheUsage = Record<CacheCategory, number>;
export const emptyCacheUsage = (): CacheUsage => ({article: 0, images: 0, other: 0});
export const cacheOtherFields = ['overview', 'key_takeaways', 'outline', 'outline_read_position', 'read_position', 'mark_users'] as const;
export const totalCacheBytes = (usage: CacheUsage, categories: readonly CacheCategory[] = cacheCategories) => categories.reduce((total, category) => total + usage[category], 0);
export const nonEmptyCacheCategories = (usage: CacheUsage) => cacheCategories.filter(category => usage[category] > 0);
export function formatCacheSize(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) return `${(Math.floor(megabytes / 1024 * 10) / 10).toFixed(1)} GB`;
  return megabytes >= 0.1 ? `${(Math.floor(megabytes * 10) / 10).toFixed(1)} MB` : '< 0.1 MB';
}
export interface CacheMaintenanceFiles {
  articleBytes(key: string): number | Promise<number>;
  imageBytes(key: string): number | Promise<number>;
  removeArticleContent(key: string): boolean | Promise<boolean>;
  removeImages(key: string): void | Promise<void>;
}
/** Only explicitly manual file caches are clearable; absent flags retain the source automatic-cache default. */
export class CacheMaintenance {
  private tail: Promise<unknown> = Promise.resolve();
  private database: SqlDatabase;
  private files: CacheMaintenanceFiles;
  private guard: () => void;
  constructor(database: SqlDatabase, files: CacheMaintenanceFiles, assertActive: () => void = () => {}) {this.database = database; this.files = files; this.guard = assertActive;}
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {this.guard(); const value = await work(); this.guard(); return value;}); this.tail = result.catch(() => undefined); return result;
  }
  private async manualIds() {
    this.guard(); const rows = await this.database.getAll<{id: string}>("SELECT id FROM ps_data_local__local_bookmark_info WHERE json_extract(data, '$.is_auto_cached') = 0"); this.guard(); return rows.map(row => row.id);
  }
  private async measure(ids: string[]): Promise<CacheUsage> {
    const usage = emptyCacheUsage();
    for (const id of ids) {this.guard(); usage.article += await this.files.articleBytes(id); this.guard(); usage.images += await this.files.imageBytes(id); this.guard();}
    const expression = cacheOtherFields.map(field => `length(CAST(coalesce(json_extract(data, '$.${field}'), '') AS BLOB))`).join(' + ');
    const row = await this.database.getOptional<{bytes: number}>(`SELECT coalesce(sum(${expression}), 0) AS bytes FROM ps_data_local__local_bookmark_info`);
    this.guard(); usage.other = Number(row?.bytes ?? 0); return usage;
  }
  usage(): Promise<CacheUsage> {return this.serialize(async () => this.measure(await this.manualIds()));}
  clear(categories: readonly CacheCategory[]): Promise<number> {
    const selected = cacheCategories.filter(category => categories.includes(category));
    return this.serialize(async () => {
      if (!selected.length) return 0;
      const ids = await this.manualIds(), before = await this.measure(ids);
      if (selected.includes('article')) {
        for (const id of ids) {
          this.guard(); const removed = await this.files.removeArticleContent(id); this.guard();
          if (removed) await this.database.writeTransaction(tx => {this.guard(); return tx.execute("UPDATE ps_data_local__local_bookmark_info SET data = json_remove(json_set(data, '$.is_downloaded', 0), '$.pdf_cache') WHERE id = ? AND json_extract(data, '$.is_auto_cached') = 0", [id]);});
        }
      }
      if (selected.includes('images')) for (const id of ids) {this.guard(); await this.files.removeImages(id); this.guard();}
      if (selected.includes('other')) {
        const paths = cacheOtherFields.map(field => `'$.${field}'`).join(', ');
        const present = cacheOtherFields.map(field => `json_type(data, '$.${field}') IS NOT NULL`).join(' OR ');
        this.guard(); await this.database.writeTransaction(tx => {this.guard(); return tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_remove(data, ${paths}) WHERE ${present}`);});
      }
      const absent = cacheOtherFields.map(field => `json_type(data, '$.${field}') IS NULL`).join(' AND ');
      const knownKeys = ['id', 'is_auto_cached', 'is_downloaded', ...cacheOtherFields].map(key => `'${key}'`).join(', ');
      for (const id of ids) {
        this.guard(); const articles = await this.files.articleBytes(id); this.guard(); const images = await this.files.imageBytes(id); this.guard();
        if (articles === 0 && images === 0) {
          // Keep unknown local fields and pin metadata even when source-known cache fields are empty.
          await this.database.writeTransaction(tx => {this.guard(); return tx.execute(`DELETE FROM ps_data_local__local_bookmark_info WHERE id = ? AND json_extract(data, '$.is_auto_cached') = 0 AND coalesce(json_extract(data, '$.is_downloaded'), 0) = 0 AND ${absent} AND NOT EXISTS (SELECT 1 FROM json_each(data) WHERE key NOT IN (${knownKeys}))`, [id]);});
        }
      }
      return Math.max(0, totalCacheBytes(before, selected) - totalCacheBytes(await this.measure(ids), selected));
    });
  }
}
