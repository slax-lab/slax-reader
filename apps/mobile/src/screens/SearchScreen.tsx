import React, {useMemo, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {SourceText, TextAction} from '../components/SourceUI';
import {SearchGlyph} from '../components/SearchGlyph';
import {SearchInput} from '../search/SearchInput';
import {SearchArticleRow, SearchSourceRow} from '../search/SearchResultRow';
import {SearchChevron} from '../search/SearchSymbols';
import {groupSearchResults} from '../search/group';
import {searchRows, type SearchRow, type SearchSection} from '../search/presentation';
import {useLibrarySearch} from '../search/useLibrarySearch';
import type {SearchArticle} from '../search/types';
import type {MobileScreenProps} from '../navigation/types';
import {mobileColors as C} from '../theme';
import {parseSourceTimestamp} from '../utils/source-time';

export function SearchScreen({navigation}: MobileScreenProps<'Search'>) {
  const search = useLibrarySearch(), {t, state} = search, insets = useSafeAreaInsets();
  const surface = useRef<React.ComponentRef<typeof View>>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<SearchSection, boolean>>({collections: false, rss: false, articles: false});
  const keyword = state.query.text.toLocaleLowerCase(), source = state.query.source;
  const tagged = !source && (search.selected.length > 0 || state.query.tagUuids.length > 0);
  const active = Boolean(search.text.trim() || tagged || source);
  const searching = state.busy || state.localBusy;
  const sections = useMemo(() => {
    const collections = search.invalid || tagged ? [] : source ? search.collections.filter(value => source.kind === 'collection' && value.id === source.id) :
      search.collections.filter(value => value.status === 1 && parseSourceTimestamp(value.subscriptionEndTime) > Date.now() && `${value.name} ${value.description}`.toLocaleLowerCase().includes(keyword));
    const feeds = search.invalid || tagged ? [] : source ? search.feeds.filter(value => source.kind === 'rss' && value.id === source.id) :
      search.feeds.filter(value => `${value.title} ${value.remark ?? ''} ${value.site_url ?? ''}`.toLocaleLowerCase().includes(keyword));
    return groupSearchResults(search.collections, search.feeds, collections, feeds, state.items);
  }, [search.collections, search.feeds, search.invalid, tagged, source, keyword, state.items]);
  const rows = useMemo(() => searchRows(sections, collapsed, source), [sections, collapsed, source]);
  const canLoadMore = rows.some(row => row.type === 'article') && state.hasMore;
  function open(article: SearchArticle) {
    navigation.navigate('Reader', article.kind === 'rss' ? {bookmarkId: '', rssEntryId: article.id, openedFrom: 'rss'} :
      {bookmarkId: article.id, ...(article.kind === 'collection' ? {collectionId: article.collectionId, collectionOwnerId: article.ownerId} : {})});
  }
  function renderRow({item}: {item: SearchRow}) {
    if (item.type === 'article') return <SearchArticleRow article={item.article} nested={item.nested} query={keyword} t={t} onOpen={open}/>;
    if (item.type === 'source') return <SearchSourceRow row={item} query={keyword} t={t} onSelect={search.selectSource}/>;
    const label = t(item.scoped ? 'search_source_articles' : item.section === 'collections' ? 'search_collections' : item.section === 'rss' ? 'rss_feeds' : 'search_articles');
    const count = t(item.section === 'articles' ? 'search_article_count' : 'search_source_count').replace('{count}', String(item.count));
    return <Pressable testID={`search-section-${item.section}`} accessibilityRole="button" accessibilityLabel={`${label}, ${count}`}
      accessibilityState={{expanded: !collapsed[item.section]}} onPress={() => setCollapsed(value => ({...value, [item.section]: !value[item.section]}))}
      style={({pressed}) => [styles.heading, pressed && styles.pressed]}>
      <SourceText style={styles.headingText}>{label}</SourceText><SourceText style={styles.count}>{count}</SourceText>
      <View style={styles.chevron}><SearchChevron down={!collapsed[item.section]}/></View>
    </Pressable>;
  }
  const pending = searching && !rows.some(row => row.type === 'section' && row.section === 'articles');
  const header = <View>
    {pending ? <View testID="search-results-loading" accessibilityLiveRegion="polite" style={styles.progress}>
      <ActivityIndicator size="small" color={C.searchActionText}/><SourceText style={styles.helper}>{t(state.busy ? 'search_enriching' : 'search_searching')}</SourceText>
    </View> : null}
    {state.localError ? <View style={styles.error}>
      <SourceText accessibilityRole="alert" style={styles.helper}>{t('search_local_failed')}</SourceText>
      <TextAction label={t('rss_retry')} color={C.searchActionText} onPress={() => search.controller.retryLocal()}/>
    </View> : null}
  </View>;
  const empty = !searching && !search.invalid && !state.localError && !rows.length ? <View testID="search-empty" style={styles.empty}>
    <View style={styles.emptyMark}><SearchGlyph/></View>
    <SourceText style={styles.emptyTitle}>{t(active ? 'search_empty_title' : 'search_start_title')}</SourceText>
    {source ? <SourceText style={styles.emptyScope}>{source.label}</SourceText> : null}
    <SourceText style={styles.emptyHint}>{t(source ? 'search_empty_source' : tagged ? 'search_empty_tags' : active ? 'search_no_local' : 'search_start_hint')}</SourceText>
    {source ? <TextAction label={t('search_all_sources')} color={C.searchActionText} onPress={() => search.selectSource(undefined)}/> :
      tagged ? <TextAction label={t('search_reset_tags')} color={C.searchActionText} onPress={() => search.setSelected([])}/> : null}
  </View> : undefined;
  return <View ref={surface} style={styles.screen} onLayout={() => surface.current?.measureInWindow((_x, y) => setKeyboardOffset(y))}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={keyboardOffset}>
      <SearchInput text={search.text} selected={search.selected} tags={search.tags} sourceLabel={source?.label} sourceKind={source?.kind} invalid={search.invalid}
        onClearSource={() => search.selectSource(undefined)} onText={search.setText} onTags={search.setSelected} onSubmit={search.submit} busy={state.busy} searching={searching} t={t}/>
      <FlatList testID="library-search-results" data={rows} keyExtractor={row => row.key} renderItem={renderRow}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{paddingBottom: insets.bottom + 24}}
        ListHeaderComponent={header} ListEmptyComponent={empty} initialNumToRender={12}
        ListFooterComponent={canLoadMore ? <TextAction label={t('search_more')} color={C.searchActionText} disabled={searching} onPress={() => search.controller.more()}/> : undefined}/>
    </KeyboardAvoidingView>
  </View>;
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: C.readerBackground},
  helper: {fontSize: 13, lineHeight: 20, color: C.searchSecondaryText, flexShrink: 1},
  heading: {minHeight: 48, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8},
  headingText: {fontSize: 12, lineHeight: 18, fontWeight: '600', color: C.searchSecondaryText, letterSpacing: 0.2},
  count: {fontSize: 12, lineHeight: 18, color: C.searchSecondaryText},
  chevron: {marginLeft: 'auto'},
  progress: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 10},
  error: {paddingHorizontal: 20, paddingVertical: 12, alignItems: 'flex-start'},
  empty: {paddingHorizontal: 32, paddingTop: 48, gap: 10, alignItems: 'center'},
  emptyMark: {width: 52, height: 52, borderRadius: 18, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 4},
  emptyTitle: {fontSize: 17, lineHeight: 25, fontWeight: '500', color: C.text, textAlign: 'center'},
  emptyScope: {fontSize: 14, lineHeight: 21, color: C.bodyText, textAlign: 'center'},
  emptyHint: {fontSize: 14, lineHeight: 22, color: C.searchSecondaryText, textAlign: 'center', maxWidth: 280},
  pressed: {backgroundColor: C.pressedOverlay},
});
