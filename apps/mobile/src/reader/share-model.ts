export interface ShareImageSource {
  ensureCached(url: string): Promise<string | null>;
  dimensions(uri: string): Promise<{width: number; height: number} | null>;
  fallback(): Promise<string | null>;
  isActive?(): boolean;
}
/** Source ShareImageSelector tries exactly the first two candidates on iOS, requiring >100px on each axis. */
export async function selectShareImage(platform: 'ios' | 'android', imageUrls: string[], source: ShareImageSource): Promise<string | null> {
  if (source.isActive?.() === false) return null;
  if (platform === 'ios') for (const url of imageUrls.slice(0, 2)) {
    try {
      const uri = await source.ensureCached(url);
      if (source.isActive?.() === false) return null;
      if (!uri) continue;
      const size = await source.dimensions(uri);
      if (source.isActive?.() === false) return null;
      if (size && size.width > 100 && size.height > 100) return uri;
    } catch { /* A broken candidate does not prevent the next candidate or source logo. */ }
    if (source.isActive?.() === false) return null;
  }
  if (source.isActive?.() === false) return null;
  const fallback = await source.fallback().catch(() => null);
  return source.isActive?.() === false ? null : fallback;
}
