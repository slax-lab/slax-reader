import React from 'react';
import {FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {SourceAvatar, SourceText, TextAction} from '../components';
import {SearchInput} from '../search/SearchInput';
import {useLibrarySearch} from '../search/useLibrarySearch';
import type {SearchArticle} from '../search/types';
import type {MobileScreenProps} from '../navigation/types';
import {mobileColors as C} from '../theme';
import {parseSourceTimestamp} from '../utils/source-time';
export function SearchScreen({navigation}: MobileScreenProps<'Search'>) {
  const search = useLibrarySearch(), {t, state} = search, insets = useSafeAreaInsets();
  const keyword = state.query.text.toLocaleLowerCase(), tagged = search.selected.length > 0 || state.query.tagUuids.length > 0;
  function open(item: SearchArticle) {
    navigation.navigate('Reader', item.kind === 'rss' ? {bookmarkId: '', rssEntryId: item.id, openedFrom: 'rss'} : {bookmarkId: item.id, ...(item.kind === 'collection' ? {collectionId: item.collectionId, collectionOwnerId: item.ownerId} : {})});
  }
  const sources = <View style={styles.sources}>
    {tagged ? <SourceText style={styles.hint}>{t('search_tag_scope')}</SourceText> : <>
      <SourceText accessibilityRole="header" style={styles.heading}>{t('search_collections')}</SourceText>
      {search.collections.filter(source => source.status === 1 && parseSourceTimestamp(source.subscriptionEndTime) > Date.now() && `${source.name} ${source.description}`.toLocaleLowerCase().includes(keyword)).map(source => <Pressable accessibilityRole="button" key={source.id} onPress={() => navigation.popTo('Library', {source: {kind: 'collection', id: source.id}})} style={styles.source}><SourceAvatar resourceKey={`collection:${source.id}`} uri={source.avatar} size={32}/><SourceText style={styles.sourceText}>{source.name}</SourceText></Pressable>)}
      <SourceText accessibilityRole="header" style={styles.heading}>{t('rss_feeds')}</SourceText>
      {search.feeds.filter(source => `${source.title} ${source.remark ?? ''} ${source.site_url ?? ''}`.toLocaleLowerCase().includes(keyword)).map(source => <Pressable accessibilityRole="button" key={source.id} onPress={() => navigation.popTo('Library', {source: {kind: 'rss', id: source.id}})} style={styles.source}><SourceText style={styles.sourceText}>{source.remark || source.title}</SourceText></Pressable>)}
    </>}
    {keyword || tagged ? <SourceText accessibilityRole="header" style={styles.heading}>{t('search_articles')}</SourceText> : <SourceText style={styles.hint}>{t('search_hint')}</SourceText>}
    {search.invalid ? <SourceText accessibilityRole="alert" style={[styles.hint, {color: C.danger}]}>{t('search_unknown_tag')}</SourceText> : null}
    {state.busy ? <SourceText accessibilityLiveRegion="polite" style={styles.hint}>{t('search_enriching')}</SourceText> : null}
    {state.error ? <View><SourceText style={styles.hint}>{t('search_remote_failed')}</SourceText><TextAction label={t('rss_retry')} onPress={search.submit}/></View> : null}
  </View>;
  return <KeyboardAvoidingView style={{flex: 1, backgroundColor: C.background}} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 44}>
    <SearchInput text={search.text} selected={search.selected} tags={search.tags} onText={search.setText} onTags={search.setSelected} onSubmit={search.submit} busy={state.busy} t={t}/>
    <FlatList testID="library-search-results" keyboardShouldPersistTaps="handled" data={state.items} keyExtractor={item => item.key} ListHeaderComponent={sources} contentContainerStyle={{paddingBottom: insets.bottom + 24}}
      renderItem={({item}) => <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => open(item)} style={styles.result}><SourceText numberOfLines={2} style={styles.resultTitle}>{item.title || item.url}</SourceText>{item.source ? <SourceText style={styles.hint}>{item.source}</SourceText> : null}<SourceText numberOfLines={3} style={styles.hint}>{item.snippet || item.description}</SourceText></Pressable>}
      ListEmptyComponent={keyword || tagged ? <SourceText style={[styles.hint, {paddingHorizontal: 24}]}>{t('search_no_local')}</SourceText> : undefined}
      ListFooterComponent={state.hasMore ? <TextAction label={t('search_more')} onPress={() => search.controller.more()}/> : undefined}/>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({sources: {paddingHorizontal: 24, paddingBottom: 12}, heading: {fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 8, color: C.text}, source: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8}, sourceText: {fontSize: 16, color: C.bodyText, flex: 1}, hint: {fontSize: 14, lineHeight: 20, color: C.secondaryText, paddingVertical: 4}, result: {paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, backgroundColor: C.readerBackground}, resultTitle: {fontSize: 16, lineHeight: 24, color: C.text}});
