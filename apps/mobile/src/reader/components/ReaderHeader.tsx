import React, {useSyncExternalStore} from 'react'
import {Animated, Pressable, StyleSheet, View} from 'react-native'
import type {RssEntryDetail} from '@slax-reader/contracts'
import type {PdfDescriptor} from '@slax-reader/contracts/pdf'
import type {BookmarkRecord, TagRecord} from '../../data'
import {SourceIcon, SourceText} from '../../components'
import {SourceCircularProgress} from '../../components/SourceRing'
import {mobileColors as C, mobileTypography as T} from '../../theme'
import {OverviewExcerpt, type OverviewBounds} from '../OverviewViews'
import {sourceDisplayTime} from '../model'
import type {Translate} from '../state/types'
import type {FeatureState} from '../state/feature-state'

export function ReaderHeaderMore({visibility, offset, t, onPress}: {visibility: FeatureState<boolean>; offset: Animated.Value; t: Translate; onPress(): void}) {
  const visible = useSyncExternalStore(visibility.subscribe, visibility.getSnapshot)
  return <Animated.View testID="reader-header-more-container" pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible}
    importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} collapsable={false} style={{width: 48, height: 44, transform: [{translateY: offset}]}}>
    <Pressable testID="reader-header-more" accessibilityRole="button" accessibilityLabel={t('detail_toolbar_share')} onPress={onPress}
      style={({pressed}) => ({width: 48, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? .5 : 1})}><SourceIcon name="ic_floating_panel_more" size={24} testID="reader-header-more-icon" /></Pressable>
  </Animated.View>
}

export function RssSaveButton({loading, rss, t, onSave}: {loading: boolean; rss: RssEntryDetail | null; t: Translate; onSave(): void}) {
  const disabled = loading || Boolean(rss?.bookmark_user_uuid) || !rss?.article_url
  return <Pressable onPress={onSave} accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} testID="reader-rss-save" style={[styles.rssSave, {backgroundColor: disabled ? '#F3EAE0' : C.rssAccent}]}>
    {loading ? <SourceCircularProgress size={14} thickness={1.5} color={C.rssAccent} /> : <SourceIcon name={rss?.bookmark_user_uuid ? 'ic_xs_tick_gray_outline_icon' : 'ic_rss_save'} size={14} style={{tintColor: rss?.bookmark_user_uuid || !rss?.article_url ? C.rssAccent : '#FFFFFF'}} />}
    <SourceText style={{fontSize: 13, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1, color: disabled ? C.rssAccent : '#FFFFFF'}}>{t(rss?.bookmark_user_uuid ? 'rss_saved' : 'rss_save')}</SourceText>
  </Pressable>
}

export function RssReaderHeader({top, rss, error, originalUrl, saveButton, t, onOriginal}: {
  top: number; rss: RssEntryDetail | null; error: string | null; originalUrl: string; saveButton: React.ReactNode; t: Translate; onOriginal(): void
}) {
  return <View style={[styles.rssHeader, {paddingTop: top + 52}]} testID="reader-rss-header">
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}><SourceIcon name="ic_rss" size={16} /><SourceText style={{fontSize: 12, lineHeight: undefined, color: '#777777'}}>{rss?.source_title}</SourceText></View>
    <SourceText style={{fontSize: 22, lineHeight: 32, fontWeight: '600'}}>{rss?.title}</SourceText>
    <SourceText style={{fontSize: 12, lineHeight: undefined, color: C.mutedText}}>{[rss?.author?.trim(), sourceDisplayTime(rss?.published_at ?? rss?.first_seen_at)].filter(Boolean).join(' · ')}</SourceText>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}><View style={{flex: 1}}>{saveButton}</View><Pressable testID="reader-original" onPress={onOriginal} disabled={!originalUrl} style={styles.rssOriginal} accessibilityRole="button"><SourceText style={{fontSize: 13, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1, color: '#555555'}}>{t('rss_original')}</SourceText></Pressable></View>
    {error ? <SourceText testID="reader-rss-error" style={{fontSize: 12, lineHeight: undefined, color: '#B3261E'}}>{t(`rss_error_${error}`)}</SourceText> : null}
    {rss?.content_truncated ? <SourceText style={{fontSize: 12, lineHeight: undefined, color: C.mutedText}}>{t('rss_truncated')}</SourceText> : null}
  </View>
}

export function ReaderHeader({top, title, record, pdf, isPdf, originalUrl, isCollection, selectedTags, overview, t, onOriginal, onTags, onOverview}: {
  top: number; title: string; record: BookmarkRecord | null; pdf: PdfDescriptor | null; isPdf: boolean; originalUrl: string; isCollection: boolean; selectedTags: TagRecord[]; overview: React.ReactNode; t: Translate; onOriginal(): void; onTags(): void; onOverview(bounds: OverviewBounds | null): void
}) {
  return <View style={[styles.header, {paddingTop: top + 44}]} testID="reader-article-header">
    <SourceText numberOfLines={3} style={T.detailTitle}>{title}</SourceText>
    <View style={styles.metadata}><SourceText style={[T.metadata, {color: C.mutedText}]}>{sourceDisplayTime(record?.createdAt)}</SourceText>
      {!isPdf || originalUrl ? <Pressable testID="reader-original" onPress={onOriginal} accessibilityRole="link"><SourceText style={[T.metadata, {color: C.link, marginLeft: 16}]}>{t('detail_view_original')}</SourceText></Pressable> : null}</View>
    {!isCollection ? <View style={styles.tags}>{selectedTags.map(tag => <View testID="tag_item" style={styles.tag} key={tag.id}><SourceText style={{fontSize: 12, lineHeight: 18, color: '#A68F5B'}}>{tag.tag_name}</SourceText></View>)}
      <Pressable accessibilityRole="button" accessibilityLabel={t('tags_title')} onPress={onTags} style={[styles.tag, {width: 21, height: 21, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center'}]}><SourceIcon name="ic_xs_yellow_plus" size={8} /></Pressable></View> : null}
    {typeof overview === 'string' ? <OverviewExcerpt content={overview} prefix={t('overview_prefix')} onPress={onOverview} /> : overview}
  </View>
}

const styles = StyleSheet.create({
  header: {paddingHorizontal: 20, paddingBottom: 24}, rssHeader: {paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, gap: 12},
  rssSave: {minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 12},
  rssOriginal: {flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#6A6E8333', alignItems: 'center', justifyContent: 'center'},
  metadata: {flexDirection: 'row', alignItems: 'center', marginTop: 12}, tags: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16},
  tag: {borderWidth: 1, borderColor: C.tagBorder, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 1},
})
