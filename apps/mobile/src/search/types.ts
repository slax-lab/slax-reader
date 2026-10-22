export interface SearchSource {kind: 'collection' | 'rss'; id: string; ownerId?: string; label?: string}
export interface SearchQuery {text: string; tagUuids: string[]; source?: SearchSource}
export interface SearchArticle {
  key: string; kind: 'own' | 'collection' | 'rss'; id: string;
  title: string; description: string; url: string; source: string; time: string;
  collectionId?: string; ownerId?: string; subscriptionId?: string; savedId?: string; snippet?: string;
}
export interface SearchPage {items: SearchArticle[]; hasMore: boolean}
export interface SearchLocalPort {
  watch(query: SearchQuery, limit: number, next: (page: SearchPage) => void, error: (error: Error) => void): () => void;
  admitRemote(ids: string[], tagUuids: string[]): Promise<Map<string, boolean>>;
}
export function plainSnippet(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\[\/?highlight\]/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}
