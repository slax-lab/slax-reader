import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, AppState, FlatList, Linking, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkState } from 'expo-network';
import {useTelemetry} from '../telemetry';
import {SourceSyncAvatar} from '../components/SourceSyncAvatar';
import {SourceLine} from '../components/SourceLine';
import {SourceCircle} from '../components/SourceRing';
import {SourceShape} from '../components/SourceShape';
import {sourceSyncState} from '../components/sync-state';
import {fixtureActions} from '../components/fixture-actions';
import type { SyncStatus } from '@powersync/common';
import { BookmarkRow, Divider, LinkInputDialog, RssFeed, RssFeedSwitcher, ScreenSurface, SourceAvatar, SourceButton, SourceDialog, SourceIcon, SourceMenu, SourceProgress, SourceText, TextAction, type LibrarySort } from '../components';
import { readContinueReading, type ContinueReadingContext, type BookmarkRecord, type CollectionRecord } from '../data';
import type { MobileScreenProps } from '../navigation/types';
import { RssController } from '../rss/controller';
import { useMobile } from '../runtime';
import { mobileColors as C, mobileLayout as L, mobileTypography as T } from '../theme';
import { mobileTestIds as IDs } from '../theme/testIds';
import type { MobileAssetName } from '../../assets';
import {CollectionSelection, type CollectionSelectionChange} from './collection-selection';
import {FeedScrollPosition, useFeedScrollPosition} from '../components/feed-scroll';
import {SourceDrawer} from '../components/SourceDrawer';
import {parseSourceTimestamp} from '../utils/source-time';

const sortKeys = {inbox: 'inbox_title', starred: 'inbox_starred', archived: 'inbox_archive'} as const;
const bookmarkKey = (item: BookmarkRecord) => item.id;
function FeedDivider() {return <Divider inset={24} />;}
export function LibraryScreen({navigation}: MobileScreenProps<'Library'>) {
  const {t, repositories, preferences, runtime, api, sessions, config, fixtureOnly, nativeResourceOwner} = useMobile();
  const telemetry = useTelemetry();
  const insets = useSafeAreaInsets(), window = useWindowDimensions(), deviceNetwork = useNetworkState(), network = fixtureOnly?.network ?? deviceNetwork;
  const [sort, setSort] = useState<LibrarySort>('inbox'), [rssSelected, setRssSelected] = useState(false), [addingRss, setAddingRss] = useState(false);
  const [clockActive, setClockActive] = useState(false);
  useFocusEffect(useCallback(() => {
    const update = () => setClockActive(AppState.currentState === 'active');
    update(); const listener = AppState.addEventListener('change', update);
    return () => {listener.remove(); setClockActive(false);};
  }, []));
  const [rows, setRows] = useState<BookmarkRecord[]>([]), [collectionRows, setCollectionRows] = useState<BookmarkRecord[]>([]), [collections, setCollections] = useState<CollectionRecord[]>([]), [activeId, setActiveId] = useState<string | null>(null);
  const [user, setUser] = useState<Record<string, unknown>>({}), [subscription, setSubscription] = useState<Record<string, unknown> | null>(null);
  const [drawer, setDrawer] = useState(false), [sortMenu, setSortMenu] = useState(false), [add, setAdd] = useState(false), [edit, setEdit] = useState<BookmarkRecord | null>(null);
  const [processing, setProcessing] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [continueReading, setContinueReading] = useState<ContinueReadingContext | null>(null), [now, setNow] = useState(Date.now());
  useEffect(() => {telemetry.track('screen_viewed', {screen_name: 'bookmarks', list_mode: sort === 'archived' ? 'archive' : sort});}, [sort, telemetry]);
  const database = runtime.getDatabase(), [sync, setSync] = useState<SyncStatus | undefined>(database?.currentStatus);
  const list = useRef<FlatList<BookmarkRecord>>(null);
  const feedPositions = useMemo(() => ({inbox: new FeedScrollPosition(), rss: new FeedScrollPosition()}), [nativeResourceOwner]);
  const scrollTo = useCallback((offset: number, animated = false) => list.current?.scrollToOffset({offset, animated}), []);
  const inboxScroll = useFeedScrollPosition(feedPositions.inbox, scrollTo, !rssSelected, activeId);
  useEffect(() => {
    inboxScroll.reset(); feedPositions.rss.reset(); feedPositions.rss.source = undefined; setDrawer(false);
  }, [nativeResourceOwner, feedPositions, inboxScroll.reset]);
  const collectionSelection = useRef(new CollectionSelection()).current;
  const rss = useMemo(() => new RssController(api, Date.now, () => runtime.getNativeResourceOwner() === nativeResourceOwner), [api, runtime, nativeResourceOwner]);
  const rssState = useSyncExternalStore(rss.subscribe, rss.getSnapshot);
  const showError = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)), []);
  useEffect(() => repositories?.watchBookmarks(sort, setRows, showError), [repositories, sort, showError]);
  useEffect(() => repositories?.watchCollections(setCollections, showError), [repositories, showError]);
  useEffect(() => repositories?.watchUser(values => setUser(values[0] ?? {}), showError), [repositories, showError]);
  useEffect(() => repositories?.watchSubscription(values => setSubscription(values[0] ?? null), showError), [repositories, showError]);
  useEffect(() => {if (database) {setSync(database.currentStatus); return database.registerListener({statusChanged: setSync});}}, [database]);
  const active = collections.find(value => value.id === activeId);
  const applyCollectionSelection = useCallback(async (change: CollectionSelectionChange | null) => {
    if (!change) return;
    setActiveId(change.id);
    inboxScroll.reset();
    if (change.markRead) {
      try {await repositories?.markCollectionRead(change.markRead);}
      catch (reason) {console.warn('Failed to update collection last-read time', reason);}
    }
  }, [repositories, inboxScroll.reset]);
  const selectCollection = useCallback((id: string | null) => applyCollectionSelection(collectionSelection.select(id, collections)), [applyCollectionSelection, collectionSelection, collections]);
  useEffect(() => {void applyCollectionSelection(collectionSelection.reconcile(collections));}, [applyCollectionSelection, collectionSelection, collections]);
  useEffect(() => {setCollectionRows([]); if (active) return repositories?.watchCollectionBookmarks(active.ownerId, setCollectionRows, showError);}, [repositories, active?.ownerId, showError]);
  const collectionExpiry = active ? parseSourceTimestamp(active.subscriptionEndTime) : NaN;
  const subscriptionExpiry = parseSourceTimestamp(String(subscription?.subscription_end_time ?? subscription?.end_time ?? ''));
  useFocusEffect(useCallback(() => {
    const update = () => {if (AppState.currentState === 'active') setNow(previous => {const current = Date.now(); return [collectionExpiry, subscriptionExpiry].some(expiry => (expiry > previous) !== (expiry > current)) ? current : previous;});};
    update();
    const timer = setInterval(update, 5000), listener = AppState.addEventListener('change', update);
    return () => {clearInterval(timer); listener.remove();};
  }, [collectionExpiry, subscriptionExpiry]));
  useFocusEffect(useCallback(() => {
    let mounted = true;
    void readContinueReading(preferences).then(async value => { if (!value) {if (mounted) setContinueReading(null); return;} await preferences.update(next => {delete next.continue_reading_bookmark;}); if (mounted && value.title.trim()) setContinueReading({...value, title: value.title.replace(/\s+/g, ' ').trim()}); }).catch(showError);
    return () => {mounted = false;};
  }, [preferences, showError]));
  useEffect(() => {rss.activate(); return () => rss.dispose();}, [rss]);
  useFocusEffect(useCallback(() => {
    void rss.load();
    const timer = setInterval(() => {if (AppState.currentState === 'active') rss.poll();}, 5000);
    const listener = AppState.addEventListener('change', value => {if (value === 'active') void rss.load(); else rss.cancel();});
    return () => {clearInterval(timer); listener.remove(); rss.cancel();};
  }, [rss]));
  useEffect(() => {if (!rssState.enabled) setAddingRss(false);}, [rssState.enabled]);
  const closed = active && active.status !== 1, expired = active && !(parseSourceTimestamp(active.subscriptionEndTime) > now);
  const blocked = activeId !== null && (!active || closed || expired);
  const shownRows = activeId === null ? rows : blocked ? [] : collectionRows;
  const openBookmark = useCallback((item: BookmarkRecord) => {
    if (activeId !== null && active && !blocked) navigation.navigate('Reader', {bookmarkId: item.id, collectionId: active.id, collectionOwnerId: active.ownerId});
    else if (item.status === 'success') navigation.navigate('Reader', {bookmarkId: item.id}); else setProcessing(item.url);
  }, [activeId, active?.id, active?.ownerId, blocked, navigation]);
  const renderBookmark = useCallback(({item}: {item: BookmarkRecord}) => <BookmarkRow item={item} sort={activeId ? 'inbox' : sort} owned={activeId === null} t={t} repositories={repositories} telemetry={telemetry} onOpen={openBookmark} onEdit={setEdit} onError={showError} />, [activeId, sort, t, repositories, telemetry, openBookmark, showError]);
  const [headerHeight, setHeaderHeight] = useState<{key: string; height: number} | null>(null);
  const headerKey = `${collections.length > 0}:${active && !blocked && shownRows.length ? `${active.id}:${active.name}` : 'own'}:${window.fontScale}`;
  const measureHeader = useCallback((event: {nativeEvent: {layout: {height: number}}}) => {const height = event.nativeEvent.layout.height; setHeaderHeight(previous => previous?.key === headerKey && previous.height === height ? previous : {key: headerKey, height});}, [headerKey]);
  const getItemLayout = useMemo(() => {
    if (headerHeight?.key !== headerKey) return undefined;
    const header = headerHeight.height;
    const length = PixelRatio.roundToNearestPixel(L.librarySwipeActionHeight), separator = PixelRatio.roundToNearestPixel(0.5);
    return (_data: ArrayLike<BookmarkRecord> | null | undefined, index: number) => ({index, length, offset: header + index * (length + separator)});
  }, [headerKey, headerHeight]);
  const requestRss = useCallback(() => setAddingRss(true), []), dismissRss = useCallback(() => setAddingRss(false), []);
  const openRssSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const openRss = useCallback((entry: {id: string}) => navigation.navigate('Reader', {bookmarkId: '', rssEntryId: entry.id, openedFrom: 'rss'}), [navigation]);
  function openRoute(route: 'Settings' | 'About' | 'Subscription' | 'Feedback') {telemetry.element(`sidebar_${route === 'Settings' ? 'settings' : route.toLowerCase()}_menu_item`, 'bookmarks'); if (route === 'Subscription' && !subscribed && config.platform === 'ios') telemetry.firebase('subscription', 'view', {source: 'screen'}); setDrawer(false); if (route === 'Feedback') navigation.navigate('Feedback', {entryPoint: 'inbox'}); else navigation.navigate(route);}
  const subscribed = Boolean(subscription && String(subscription.subscription_end_time ?? subscription.end_time ?? '') && parseSourceTimestamp(String(subscription.subscription_end_time ?? subscription.end_time)) > now);
  const syncState = sourceSyncState(sync, network.isConnected !== false && network.isInternetReachable !== false);
  const syncText = syncState.kind === 'error' ? syncState.message : syncState.kind === 'offline' ? t('sync_no_network') : syncState.kind === 'uploading' ? t('sync_uploading') : syncState.kind === 'downloading' ? t('sync_downloading') : syncState.kind === 'connecting' ? t('sync_connecting') : '';
  const progress = syncState.kind === 'downloading' ? syncState.progress : undefined;
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return;
    return fixtureActions.subscribe('library', async action => {
      if (action.kind === 'select-list') {
        if (action.list === 'rss') {await rss.load(); setRssSelected(true);}
        else if (action.list === 'inbox' || action.list === 'starred' || action.list === 'archived') {setRssSelected(false); setSort(action.list);}
        else throw new Error('Unknown fixture list');
        return true;
      }
      if (action.kind === 'select-source') {if (rssSelected) await rss.select(String(action.id)); else {if (action.id !== null && !collections.some(value => value.id === action.id)) throw new Error('Unknown fixture collection'); await selectCollection(action.id as string | null);} return true;}
      if (action.kind === 'load-history') {
        if (!rssSelected) throw new Error('RSS is not selected');
        const disabled = rssState.busy || Boolean(rssState.retryAt && Date.parse(rssState.retryAt) > Date.now());
        if (action.expectDisabled === true) {if (!disabled) throw new Error('Fixture history control should be disabled'); return true;}
        if (disabled) throw new Error('Fixture history control is disabled'); await rss.more(); return true;
      }
      if (action.kind === 'open-sidebar') {setDrawer(true); return true;}
      if (action.kind === 'open-sort-menu') {setSortMenu(true); return true;}
      if (action.kind === 'open-add-link') {setAdd(true); return true;}
      return false;
    });
  }, [fixtureOnly, rss, rssSelected, rssState.busy, rssState.retryAt, collections, selectCollection]);
  const sidebar = <View style={[styles.drawer, {paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8}]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('sidebar_close')} onPress={() => setDrawer(false)} style={{marginLeft: 12, width: 24}} hitSlop={10}><SourceIcon name="ic_xs_sidebar_close" /></Pressable>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: 12, marginVertical: 16}}><SourceAvatar uri={String(user.picture ?? '')} label={t('sidebar_user_avatar')} /><SourceText style={{fontSize: 16, lineHeight: 20, fontWeight: '600', flexShrink: 1}}>{String(user.name ?? '')}</SourceText></View>
      {syncText ? <View testID={IDs.SyncStatusBar} style={styles.sync}><View style={{flexDirection: 'row', justifyContent: 'space-between'}}><SourceText testID={IDs.SyncStatusText} style={[T.syncStatus, {color: C.bodyText}]}>{syncText}</SourceText>{syncState.kind === 'downloading' && progress != null ? <SourceText style={T.syncStatus}>{Math.floor(progress * 100)}%</SourceText> : null}</View>{syncState.kind === 'downloading' || syncState.kind === 'connecting' || syncState.kind === 'uploading' ? <View style={{marginTop: 8}}><SourceProgress value={progress} testID={IDs.SyncProgress} /></View> : null}</View> : null}
      <View style={{flex: 1}} />
      {!subscribed && config.platform === 'ios' ? <Pressable accessibilityRole="button" onPress={() => openRoute('Subscription')} style={styles.subscription}><SourceIcon name="ic_xs_sidebar_subscribed" size={16} /><SourceText style={{fontSize: 15, lineHeight: 21, color: C.subscriptionText}}>{t('sidebar_subscription')}</SourceText><SourceIcon name="ic_xs_sidebar_yellow_arrow" size={20} /></Pressable> : null}
      {[...(subscribed ? [{route: 'Subscription' as const, label: 'sidebar_subscription', icon: 'ic_xs_sidebar_subscribe' as MobileAssetName}] : []), {route: 'Settings' as const, label: 'sidebar_settings', icon: 'ic_xs_sidebar_config' as MobileAssetName}, {route: 'Feedback' as const, label: 'sidebar_feedback', icon: 'ic_xs_sidebar_feedback' as MobileAssetName}, {route: 'About' as const, label: 'sidebar_about', icon: 'ic_xs_sidebar_about' as MobileAssetName}].map(item => <Pressable key={item.route} accessibilityRole="button" onPress={() => openRoute(item.route)} style={({pressed}) => [styles.drawerItem, {backgroundColor: pressed ? C.pressedOverlay : 'transparent'}]}><SourceIcon name={item.icon} size={20} /><SourceText style={{fontSize: 16, lineHeight: 20, color: C.bodyText}}>{t(item.label)}</SourceText></Pressable>)}
      <Pressable accessibilityRole="button" onPress={() => {telemetry.element('sidebar_logout_menu_item', 'bookmarks'); void sessions.signOut().catch(showError);}} style={styles.drawerItem}><SourceIcon name="ic_xs_sidebar_logout" size={20} /><SourceText style={{fontSize: 16, lineHeight: 20, color: C.bodyText}}>{t('sidebar_logout')}</SourceText></Pressable>
  </View>;
  return <ScreenSurface bottomInset={false}><SourceDrawer open={drawer} onOpenChange={setDrawer} width={Math.min(window.width, L.drawerMaximumWidth)} drawer={sidebar} testID={IDs.SidebarDrawer}>
    <View style={{paddingTop: insets.top}}>
      <View style={styles.navigation}>
        <Pressable accessibilityRole="button" accessibilityLabel="Menu" onPress={() => {telemetry.element('sidebar_open_button', 'bookmarks'); setDrawer(true);}} style={({pressed}) => [styles.navLeft, {opacity: pressed ? 0.5 : 1}]}><SourceIcon name="ic_inbox_tab" /><SourceSyncAvatar uri={String(user.picture ?? '')} state={syncState} isBeta={config.isBeta} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Switch List" onPress={() => setSortMenu(true)} style={styles.navTitle}><SourceLine text={t(rssSelected ? 'rss_feeds' : sortKeys[sort])} fontSize={17} lineHeight={24} fontWeight={500} color={C.text} alignment="center" fitContent style={{alignSelf: 'center'}} /><SourceIcon name="inbox_more" size={10} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Add Link" onPress={() => {telemetry.element('bookmark_add_button', 'bookmarks'); rssSelected ? setAddingRss(true) : setAdd(true);}} style={({pressed}) => [styles.navAdd, {opacity: pressed ? 0.5 : 1}]}><SourceIcon name="ic_xs_inbox_add" /></Pressable>
      </View>
      <Pressable accessible={false} style={{position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 10}} onPress={() => inboxScroll.reset(true)} />
    </View>
    <SourceShape radius={16} corners="top" fillColor={C.readerBackground} style={[styles.feed, Platform.OS === 'android' && {backgroundColor: 'transparent', borderTopLeftRadius: 0, borderTopRightRadius: 0, overflow: 'visible'}]}>
      {rssSelected ? <RssFeed key={nativeResourceOwner} active={clockActive} state={rssState} controller={rss} scrollPosition={feedPositions.rss} adding={addingRss} onDismissAdd={dismissRss} onRequestAdd={requestRss} onOpenSettings={openRssSettings} onOpen={openRss} header={rssState.enabled ? <View style={{backgroundColor: C.background}}><RssFeedSwitcher state={rssState} controller={rss} onAdd={requestRss} /></View> : null} /> : <>
        <FlatList key={JSON.stringify([nativeResourceOwner, activeId])} ref={list} {...inboxScroll.events} maintainVisibleContentPosition={inboxScroll.maintainVisibleContentPosition} data={shownRows} keyExtractor={bookmarkKey} getItemLayout={getItemLayout} initialNumToRender={16} maxToRenderPerBatch={6} windowSize={5} contentContainerStyle={[{paddingBottom: insets.bottom + 16}, !shownRows.length && {flexGrow: 1}]}
          ListHeaderComponent={<View testID="library-scrolling-header" onLayout={measureHeader}>
            {collections.length > 0 ? <View testID="library-collection-strip" style={[{height: 96, backgroundColor: C.background}, Platform.OS === 'android' && {paddingTop: PixelRatio.roundToNearestPixel(12), paddingBottom: PixelRatio.roundToNearestPixel(16)}]}><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow: 0, height: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(96) - PixelRatio.roundToNearestPixel(12) - PixelRatio.roundToNearestPixel(16) : 96}} contentContainerStyle={[styles.sources, Platform.OS === 'android' && {paddingTop: 0, paddingBottom: 0}]}>
              {[{id: null, name: t('collection_my_inbox'), avatar: String(user.picture ?? ''), hasNew: false}, ...collections].map(source => <Pressable key={source.id ?? 'own'} accessibilityRole="tab" accessibilityState={{selected: activeId === source.id}} onPress={() => {void selectCollection(source.id);}} style={styles.source}><View style={styles.sourceCircle}><View pointerEvents="none" style={StyleSheet.absoluteFill}><SourceCircle size={48} thickness={0.5} border={activeId === source.id ? C.rssSelectedBorder : 'transparent'} /></View><SourceAvatar uri={source.avatar} size={42} label={source.name} />{source.hasNew ? <View pointerEvents="none" style={styles.newDot}><SourceCircle size={9} thickness={1.5} border={C.readerBackground} fill={C.rssAccent} /></View> : null}</View><SourceLine text={source.name} fontSize={11} lineHeight={14} ellipsis="middle" alignment="center" fontWeight={activeId === source.id ? 500 : 400} color={activeId === source.id ? C.text : C.mutedText} style={{marginTop: 6}} /></Pressable>)}
            </ScrollView></View> : null}
            <View style={{height: 8}} />
            {active && !blocked && shownRows.length ? <SourceText numberOfLines={1} style={[T.toolbarLabel, {color: C.mutedText, marginHorizontal: 24, marginTop: 4}]}>{t('collection_owner_feed_title', [active.name])}</SourceText> : null}
          </View>}
          renderItem={renderBookmark}
          ItemSeparatorComponent={FeedDivider}
          ListEmptyComponent={activeId !== null ? <View style={styles.collectionMessage}><SourceText style={[T.metadata, {color: C.rssIconMuted, lineHeight: 22}]}>{!active ? t('collection_unavailable') : closed ? t('collection_closed_message', [active.name]) : expired ? t('collection_expired_message', [active.name]) : t('collection_empty')}</SourceText></View> : <EmptyInbox />}
          ListFooterComponent={shownRows.length ? <View><Divider inset={24} /><SourceLine text={t('list_no_more')} fontSize={14} lineHeight={20} centerAsGroup color={C.mutedText} style={{marginVertical: 34}} /></View> : null} />
        {activeId === null && continueReading ? <ContinueBanner value={continueReading} bottom={insets.bottom} onDismiss={() => setContinueReading(null)} onOpen={() => {telemetry.element('continue_reading_button', 'bookmarks'); navigation.navigate('Reader', {bookmarkId: continueReading.bookmarkId, collectionOwnerId: continueReading.collectionOwnerId ?? undefined, collectionId: continueReading.collectionId ?? undefined, openedFrom: 'bookmarks'});}} /> : null}
      </>}
    </SourceShape>
    <SourceMenu visible={sortMenu} anchor={{x: (window.width - 200) / 2, y: insets.top + 52}} onDismiss={() => setSortMenu(false)} items={[...(['inbox', 'starred', 'archived'] as const).map(value => ({label: t(sortKeys[value]), selected: !rssSelected && value === sort, onPress: () => {telemetry.element('inbox_sort_control', 'bookmarks'); setRssSelected(false); setSort(value);}})), ...(rssState.enabled ? [{label: t('rss_feeds'), selected: rssSelected, onPress: () => {telemetry.element('inbox_rss_control', 'bookmarks'); setRssSelected(true);}}] : [])]} />
    <LinkInputDialog visible={add} onDismiss={() => setAdd(false)} onSubmit={url => {telemetry.firebase('bookmark', 'add_start', {channel: 'app', method: 'manual_paste'}); void repositories?.createBookmark(url).then(() => inboxScroll.reset(true)).catch(showError);}} />
    <LinkInputDialog visible={edit !== null} initialTitle={edit ? edit.aliasTitle || edit.title : undefined} onDismiss={() => setEdit(null)} onSubmit={title => {if (edit) void repositories?.updateBookmark(edit.id, {aliasTitle: title}).catch(showError);}} />
    <SourceDialog compact visible={processing !== null} onDismiss={() => setProcessing(null)}><View style={{alignItems: 'flex-end'}}><Pressable accessibilityLabel={t('btn_close')} onPress={() => setProcessing(null)}><SourceIcon name="ic_xs_dialog_close" /></Pressable></View><SourceText style={[T.menu, {color: C.bodyText, marginTop: 20}]}>{t('processing_message')}</SourceText><SourceButton label={t('processing_btn_read_original')} style={{marginTop: 24}} onPress={() => {const url = processing; setProcessing(null); if (fixtureOnly) {showError(new Error('External browser navigation has no prepared fixture provider')); return;} if (url && /^https?:\/\//.test(url)) void Linking.openURL(url).catch(showError);}} /></SourceDialog>
    <SourceDialog visible={error !== null} title={t('feedback_error_title')} onDismiss={() => setError(null)} actions={<TextAction label={t('btn_ok')} onPress={() => setError(null)} />}><SourceText>{error}</SourceText></SourceDialog>
  </SourceDrawer></ScreenSurface>;
}
function EmptyInbox() {
  const {t} = useMobile();
  return <View testID={IDs.EmptyOrLoading} style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}><View testID={IDs.EmptyInbox} style={styles.empty}><SourceIcon name="ic_outline_empty_inboxlist_icon" label={t('empty_inbox_icon_desc')} /><SourceText style={{fontSize: 18, lineHeight: 25, fontWeight: '600', color: '#403735', marginTop: 24}}>{t('empty_inbox_title')}</SourceText><View style={{alignSelf: 'stretch', marginVertical: 34}}><Divider /></View><View style={{gap: 20, paddingHorizontal: 25, alignSelf: 'stretch'}}>{[1, 2].map(index => <View key={index} style={{flexDirection: 'row', gap: 8}}><SourceText style={[T.metadata, {color: C.mutedText}]}>{index}.</SourceText><SourceText style={[T.metadata, {color: C.mutedText, flex: 1}]}>{t(`empty_inbox_tip_${index}`)}</SourceText></View>)}</View></View></View>;
}
function ContinueBanner({value, bottom, onDismiss, onOpen}: {value: ContinueReadingContext; bottom: number; onDismiss(): void; onOpen(): void}) {
  const {t} = useMobile(), animated = useRef(new Animated.Value(0)).current;
  useEffect(() => {Animated.timing(animated, {toValue: 1, duration: 300, useNativeDriver: true}).start();}, [animated]);
  return <Animated.View style={[styles.continueArea, {height: 108 + bottom, opacity: animated, transform: [{translateY: animated.interpolate({inputRange: [0, 1], outputRange: [34, 0]})}]}]}><Pressable accessibilityRole="button" accessibilityLabel={t('continue_reading_desc')} onPress={onOpen} style={styles.continue}>{Platform.OS === 'android' ? <SourceShape pointerEvents="none" accessible={false} radius={16} borderWidth={1} borderColor={C.border} style={StyleSheet.absoluteFill} /> : <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.continueBorder]} />}<SourceIcon name="ic_continue_reading_icon" size={14} /><SourceLine text={value.title} fontSize={15} lineHeight={18} color="#4D4D4D" style={{flex: 1}} /><View style={{width: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(1) : 1, height: 16, backgroundColor: '#CAA68E3D', marginLeft: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(8) - PixelRatio.roundToNearestPixel(6) : 2, marginRight: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(12) - PixelRatio.roundToNearestPixel(6) : 6}} /><Pressable accessibilityRole="button" accessibilityLabel={t('continue_reading_close_desc')} hitSlop={10} onPress={() => Animated.timing(animated, {toValue: 0, duration: 300, useNativeDriver: true}).start(onDismiss)}><SourceIcon name="ic_continue_reading_close" size={12} /></Pressable></Pressable></Animated.View>;
}
const styles = StyleSheet.create({navigation: {minHeight: 24 + 2 * PixelRatio.roundToNearestPixel(10), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, navLeft: {paddingLeft: 24, paddingVertical: PixelRatio.roundToNearestPixel(10), flexDirection: 'row', gap: 6, alignItems: 'center'}, navTitle: {position: 'absolute', left: 90, right: 90, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(4) : 4, paddingVertical: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(5) : 5}, navAdd: {paddingHorizontal: 24, paddingVertical: PixelRatio.roundToNearestPixel(10)}, sources: {paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: PixelRatio.roundToNearestPixel(12)}, source: {width: 72, alignItems: 'center'}, sourceCircle: {width: 48, height: 48, borderRadius: 24, padding: 3, alignItems: 'center', justifyContent: 'center'}, newDot: {position: 'absolute', right: PixelRatio.roundToNearestPixel(2), top: PixelRatio.roundToNearestPixel(2), height: PixelRatio.roundToNearestPixel(9), width: PixelRatio.roundToNearestPixel(9)}, feed: {flex: 1, backgroundColor: C.readerBackground, borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden'}, collectionMessage: {flex: 1, padding: 32, justifyContent: 'center'}, drawer: {height: '100%', backgroundColor: C.background, paddingHorizontal: 8}, drawerItem: {minHeight: 56, borderRadius: 12, flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16}, subscription: {marginHorizontal: 16, marginVertical: 20, minHeight: 36, paddingHorizontal: 12, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10, experimental_backgroundImage: 'linear-gradient(to right, #272220, #4B4441)'}, sync: {marginHorizontal: 12, padding: 12, borderRadius: 8, backgroundColor: C.syncBackground}, progress: {height: 5, marginTop: 8, borderRadius: 2.5, overflow: 'hidden', backgroundColor: C.syncTrack}, empty: {transform: [{translateY: -65}], marginHorizontal: 30, maxWidth: 315, alignItems: 'center', alignSelf: 'stretch'}, continueArea: {position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 8, paddingTop: 13, experimental_backgroundImage: 'linear-gradient(to bottom, #FCFCFC00, #FCFCFCE6, #FCFCFC)'}, continue: {flexDirection: 'row', alignItems: 'center', gap: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(6) : 6, borderRadius: 16, padding: 16, backgroundColor: C.surface, ...Platform.select({android: {elevation: 40, shadowColor: '#00000014'}, default: {boxShadow: [{offsetX: 0, offsetY: 20, blurRadius: 40, color: '#00000004'}]}})}, continueBorder: {borderRadius: 16, borderWidth: 1, borderColor: C.border}});
