import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AppImage} from '../components/AppImage';
import {SourceAvatar, SourceIcon, SourceText} from '../components/SourceUI';
import type {MobileContextValue} from '../runtime';
import {mobileColors as C} from '../theme';
import {SearchChevron} from './SearchSymbols';
import {searchExcerpt, searchHost, searchTextRuns, type SearchRow} from './presentation';
import type {SearchArticle, SearchSource} from './types';

type Translate = MobileContextValue['t'];
function MatchText({text, query}: {text: string; query: string}) {
  return <>{searchTextRuns(text, query).map((run, index) => run.match ?
    <Text key={index} style={styles.match}>{run.text}</Text> : run.text)}</>;
}

function FeedMark({uri}: {uri?: string | null}) {
  const [failed, setFailed] = useState(false);
  return <View style={styles.mark}>
    {uri && !failed ? <AppImage source={uri} fit="contain" maxPixels={4096} style={styles.feedImage} onError={() => setFailed(true)}/> :
      <SourceIcon name="ic_rss" size={20}/>}
  </View>;
}

export function SearchSourceRow({row, query, t, onSelect}: {
  row: Extract<SearchRow, {type: 'source'}>; query: string; t: Translate; onSelect(source: SearchSource): void;
}) {
  const {group, kind} = row;
  const source = group.source;
  const subtitle = row.kind === 'rss' ? searchHost(row.group.source?.site_url ?? row.group.source?.feed_url ?? '') : row.group.source?.description;
  const select = () => {if (source) onSelect({kind, id: source.id, label: group.title, ...(row.kind === 'collection' ? {ownerId: row.group.source?.ownerId} : {})});};
  return <Pressable testID={`search-source-${group.key}`} accessibilityRole="button" disabled={!source}
    accessibilityLabel={`${group.title}${source ? `, ${t('search_within_source')}` : ''}`} onPress={select}
    style={({pressed}) => [styles.source, pressed && styles.pressed]}>
    {kind === 'collection' ? group.avatar ? <SourceAvatar resourceKey={group.key} uri={group.avatar} size={34}/> :
      <View style={styles.mark}><SourceText style={styles.initial}>{group.title.slice(0, 1).toLocaleUpperCase()}</SourceText></View> :
      <FeedMark key={row.kind === 'rss' ? row.group.source?.icon_url : ''} uri={row.kind === 'rss' ? row.group.source?.icon_url : undefined}/>}
    <View style={styles.sourceBody}>
      <SourceText numberOfLines={2} style={styles.sourceTitle}><MatchText text={group.title} query={query}/></SourceText>
      <SourceText numberOfLines={1} style={styles.sourceDetail}>{group.items.length ? t('search_match_count').replace('{count}', String(group.items.length)) : subtitle || t('search_within_source')}</SourceText>
    </View>
    {source ? <SearchChevron/> : null}
  </Pressable>;
}

export function SearchArticleRow({article, nested, query, onOpen}: {
  article: SearchArticle; nested: boolean; query: string; onOpen(article: SearchArticle): void;
}) {
  const snippet = searchExcerpt(article.snippet || article.description, query);
  const site = searchHost(article.url) || article.source;
  const date = /^\d{4}-\d{2}-\d{2}/.exec(article.time)?.[0]?.replace(/-/g, '.');
  return <Pressable testID={`search-result-${article.key}`} accessibilityRole="button" accessibilityLabel={article.title || article.url}
    onPress={() => onOpen(article)} style={({pressed}) => [styles.article, nested && styles.nested, pressed && styles.pressed]}>
    <SourceText numberOfLines={2} style={styles.title}><MatchText text={article.title || article.url} query={query}/></SourceText>
    {snippet ? <SourceText numberOfLines={2} style={styles.snippet}><MatchText text={snippet} query={query}/></SourceText> : null}
    {site || date ? <View style={styles.metadata}>
      {site ? <SourceText numberOfLines={1} style={styles.site}>{site}</SourceText> : null}
      {date ? <SourceText style={styles.date}>{date}</SourceText> : null}
    </View> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  source: {minHeight: 72, marginHorizontal: 20, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border},
  mark: {width: 34, height: 34, borderRadius: 10, backgroundColor: C.selectedOverlay, alignItems: 'center', justifyContent: 'center', flexShrink: 0},
  initial: {fontSize: 16, lineHeight: 22, fontWeight: '600', color: C.searchActionText},
  feedImage: {width: 22, height: 22, borderRadius: 4},
  sourceBody: {flex: 1, gap: 2},
  sourceTitle: {fontSize: 16, lineHeight: 23, fontWeight: '500', color: C.text},
  sourceDetail: {fontSize: 12, lineHeight: 18, color: C.searchSecondaryText},
  article: {paddingHorizontal: 20, paddingVertical: 16, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border},
  nested: {marginLeft: 20, paddingLeft: 46},
  title: {fontSize: 17, lineHeight: 25, fontWeight: '500', color: C.text},
  snippet: {fontSize: 14, lineHeight: 21, color: C.searchSecondaryText},
  match: {fontWeight: '600', color: C.searchActionText},
  metadata: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 2},
  site: {flex: 1, fontSize: 12, lineHeight: 18, color: C.searchSecondaryText},
  date: {fontSize: 12, lineHeight: 18, color: C.searchSecondaryText, flexShrink: 0, marginLeft: 'auto'},
  pressed: {backgroundColor: C.pressedOverlay},
});
