import type {RssSubscription} from '@slax-reader/contracts';
import type {CollectionRecord} from '../data/repositories/types.ts';
import type {SearchArticle} from './types.ts';

export interface SearchSourceGroup<S> {
  key: string;
  title: string;
  avatar?: string;
  source: S | null;
  items: SearchArticle[];
}

export interface SearchSections {
  collections: SearchSourceGroup<CollectionRecord>[];
  feeds: SearchSourceGroup<RssSubscription>[];
  own: SearchArticle[];
}

function hitsBy(items: SearchArticle[], key: (item: SearchArticle) => string | undefined) {
  const groups = new Map<string, SearchArticle[]>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    const rows = groups.get(value);
    if (rows) rows.push(item); else groups.set(value, [item]);
  }
  return groups;
}

/** Attach collection and RSS hits to their source so each result appears in its own category. */
export function groupSearchResults(
  collections: CollectionRecord[],
  feeds: RssSubscription[],
  matchedCollections: CollectionRecord[],
  matchedFeeds: RssSubscription[],
  items: SearchArticle[],
): SearchSections {
  const collectionHits = hitsBy(items, item => item.kind === 'collection' ? item.collectionId ?? `source:${item.source}` : undefined);
  const feedHits = hitsBy(items, item => item.kind === 'rss' ? (item.subscriptionId ? `id:${item.subscriptionId}` : `source:${item.source}`) : undefined);
  const collectionMatches = new Set(matchedCollections.map(source => source.id));
  const feedMatches = new Set(matchedFeeds.map(source => source.id));
  const collectionGroups: SearchSourceGroup<CollectionRecord>[] = [];
  const feedGroups: SearchSourceGroup<RssSubscription>[] = [];
  for (const source of collections) {
    const hits = collectionHits.get(source.id), matched = collectionMatches.has(source.id);
    if (!matched && !hits?.length) continue;
    collectionGroups.push({key: `collection:${source.id}`, title: source.name, avatar: source.avatar, source, items: hits ?? []});
    collectionHits.delete(source.id);
  }
  for (const [id, hits] of collectionHits) {
    collectionGroups.push({key: `collection:${id}`, title: hits[0]?.source || 'Collection', source: null, items: hits});
  }
  for (const source of feeds) {
    const hits = feedHits.get(`id:${source.id}`), matched = feedMatches.has(source.id);
    if (!matched && !hits?.length) continue;
    feedGroups.push({key: `rss:${source.id}`, title: source.remark || source.title, source, items: hits ?? []});
    feedHits.delete(`id:${source.id}`);
  }
  for (const [id, hits] of feedHits) {
    feedGroups.push({key: `rss:${id}`, title: hits[0]?.source || 'RSS', source: null, items: hits});
  }
  return {collections: collectionGroups, feeds: feedGroups, own: items.filter(item => item.kind === 'own')};
}
