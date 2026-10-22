import type {TagRecord} from '../data/repositories/types.ts';
import type {SearchQuery} from './types.ts';
export function resolveTypedTags(text: string, selected: string[], tags: TagRecord[]): {query: SearchQuery; unresolved: boolean} {
  const ids = new Set(selected), remaining: string[] = [];
  let unresolved = false;
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    if (!token.startsWith('#')) {remaining.push(token); continue;}
    const name = token.slice(1).toLocaleLowerCase(), matches = tags.filter(tag => tag.tag_name.toLocaleLowerCase() === name);
    if (name && matches.length === 1) ids.add(matches[0]!.id);
    else {unresolved = true; remaining.push(token);}
  }
  return {query: {text: remaining.join(' '), tagUuids: [...ids]}, unresolved};
}
export function tagSuggestions(text: string, tags: TagRecord[]): TagRecord[] {
  const token = /(?:^|\s)#([^#]*)$/.exec(text);
  return token ? tags.filter(tag => tag.tag_name.toLocaleLowerCase().includes(token[1]!.trim().toLocaleLowerCase())).slice(0, 20) : [];
}
