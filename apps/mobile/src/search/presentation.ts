import type {RssSubscription} from '@slax-reader/contracts';
import type {CollectionRecord} from '../data/repositories/types.ts';
import type {SearchSections, SearchSourceGroup} from './group.ts';
import type {SearchArticle, SearchSource} from './types.ts';
import {plainSnippet} from './types.ts';

export type SearchSection = 'collections' | 'rss' | 'articles';
export type SearchRow =
  | {key: string; type: 'section'; section: SearchSection; count: number; scoped: boolean}
  | {key: string; type: 'source'; kind: 'collection'; group: SearchSourceGroup<CollectionRecord>}
  | {key: string; type: 'source'; kind: 'rss'; group: SearchSourceGroup<RssSubscription>}
  | {key: string; type: 'article'; article: SearchArticle; nested: boolean};

/** All article kinds share one virtualized list, including hits beneath sources. */
export function searchRows(sections: SearchSections, collapsed: Record<SearchSection, boolean>, scope?: SearchSource): SearchRow[] {
  const rows: SearchRow[] = [];
  const articles = (items: SearchArticle[], nested: boolean) => {
    for (const article of items) rows.push({key: article.key, type: 'article', article, nested});
  };
  if (scope) {
    const items = (scope.kind === 'rss' ? sections.feeds : sections.collections).flatMap(group => group.source?.id === scope.id ? group.items :
      group.items.filter(article => scope.kind === 'rss' ? article.subscriptionId === scope.id : article.collectionId === scope.id));
    if (items.length) {
      rows.push({key: 'section:articles', type: 'section', section: 'articles', count: items.length, scoped: true});
      if (!collapsed.articles) articles(items, false);
    }
    return rows;
  }
  if (sections.collections.length) {
    rows.push({key: 'section:collections', type: 'section', section: 'collections', count: sections.collections.length, scoped: false});
    if (!collapsed.collections) for (const group of sections.collections) {
      rows.push({key: group.key, type: 'source', kind: 'collection', group});
      articles(group.items, true);
    }
  }
  if (sections.feeds.length) {
    rows.push({key: 'section:rss', type: 'section', section: 'rss', count: sections.feeds.length, scoped: false});
    if (!collapsed.rss) for (const group of sections.feeds) {
      rows.push({key: group.key, type: 'source', kind: 'rss', group});
      articles(group.items, true);
    }
  }
  if (sections.own.length) {
    rows.push({key: 'section:articles', type: 'section', section: 'articles', count: sections.own.length, scoped: false});
    if (!collapsed.articles) articles(sections.own, false);
  }
  return rows;
}

export function searchHost(url: string): string {
  try {return new URL(url).hostname.replace(/^www\./, '');} catch {return '';}
}

function terms(query: string) {return [...new Set(query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))].slice(0, 12);}

export function searchExcerpt(value: string, query: string): string {
  const text = plainSnippet(value).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  // Some source summaries contain only a timestamp; keep it in metadata instead.
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(text)) return '';
  if (text.length <= 150) return text;
  const lower = text.toLocaleLowerCase();
  const matches = terms(query).map(term => lower.indexOf(term)).filter(index => index >= 0);
  const start = matches.length ? Math.max(0, Math.min(...matches) - 36) : 0;
  return `${start ? '…' : ''}${text.slice(start, start + 150).trim()}${start + 150 < text.length ? '…' : ''}`;
}

export function searchTextRuns(text: string, query: string): {text: string; match: boolean}[] {
  const lower = text.toLocaleLowerCase(), ranges: [number, number][] = [];
  for (const term of terms(query)) {
    let from = 0, at: number;
    while ((at = lower.indexOf(term, from)) >= 0) {
      ranges.push([at, at + term.length]); from = at + term.length;
      if (ranges.length >= 100) break;
    }
  }
  const merged: [number, number][] = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push([...range]);
  }
  const runs: {text: string; match: boolean}[] = [];
  let at = 0;
  for (const [start, end] of merged) {
    if (at < start) runs.push({text: text.slice(at, start), match: false});
    runs.push({text: text.slice(start, end), match: true}); at = end;
  }
  if (at < text.length) runs.push({text: text.slice(at), match: false});
  return runs;
}
