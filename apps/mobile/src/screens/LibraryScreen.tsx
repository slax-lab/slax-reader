import {SearchGlyph} from '../components/SearchGlyph';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, type FlatList, Linking, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {useTelemetry} from '../telemetry';
import {LibrarySyncAvatar} from '../components/LibrarySyncAvatar';
import {LibrarySyncStatus} from '../components/LibrarySyncStatus';
import {SourceLine} from '../components/SourceLine';
import {SourceCircle} from '../components/SourceRing';
import {SourceShape} from '../components/SourceShape';
import {fixtureActions} from '../components/fixture-actions';
import { BookmarkRow, Divider, LinkInputDialog, RssFeed, RssFeedSwitcher, ScreenSurface, SourceAvatar, SourceButton, SourceDialog, SourceIcon, SourceMenu, SourceText, TextAction, type LibrarySort } from '../components';
import { readContinueReading, type ContinueReadingContext, type LibraryBookmark, type LibraryCollection } from '../data';
import type { MobileScreenProps } from '../navigation/types';
import { RssController } from '../rss/controller';
import { useMobile } from '../runtime';
import { mobileColors as C, mobileLayout as L, mobileTypography as T } from '../theme';
import { mobileTestIds as IDs } from '../theme/testIds';
import type { MobileAssetName } from '../../assets';
import {CollectionSelection, type CollectionSelectionChange} from './collection-selection';
import {FeedScrollPosition, useFeedScrollPosition} from '../components/feed-scroll';
import {SourceDrawer} from '../components/SourceDrawer';
import {FeedList} from '../components/FeedList';
import {useAppForeground} from '../components/useAppForeground';
import {parseSourceTimestamp} from '../utils/source-time';
import {PdfImportDialog} from '../components/PdfImportDialog';
import {usePdfLab} from '../pdf/usePdfLab';
import {LibraryDataStatus} from './LibraryDataStatus';
import {useVisibleSnapshot} from '../components/useVisibleSnapshot';
import {useObserveMarkInteractive} from '../observe';
import {libraryIsInteractive} from '../observe/readiness';

declare global {var __SLAX_UI_RSS_STATE__: unknown;}

const sortKeys = {inbox: 'inbox_title', starred: 'inbox_starred', archived: 'inbox_archive'} as const;
const bookmarkKey = (item: LibraryBookmark) => item.id;
function FeedDivider() {return <Divider inset={24} />;}
export function LibraryScreen({navigation, route}: MobileScreenProps<'Library'>) {
  const {t, repositories, preferences, runtime, api, sessions, config, fixtureOnly, nativeResourceOwner, upgrade, retryStart, systemSurfaces} = useMobile();
  const dataReady = Boolean(repositories && nativeResourceOwner && upgrade.status === 'ready');
  const telemetry = useTelemetry();
  const markInteractive = useObserveMarkInteractive();
  const pdfLab = usePdfLab();
  const [importingPdf, setImportingPdf] = useState(false);
  const insets = useSafeAreaInsets(), window = useWindowDimensions();
  const [sort, setSort] = useState<LibrarySort>('inbox'), [rssSelected, setRssSelected] = useState(false), [addingRss, setAddingRss] = useState(false);
  const [focused, setFocused] = useState(false), foreground = useAppForeground();
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => {setFocused(false); setImportingPdf(false);};
  }, []));
  // List watches, clocks and RSS polling suspend while the Library is covered or the app is backgrounded.
  const clockActive = focused && foreground;
  const listOwner = useMemo(() => ({}), [repositories, nativeResourceOwner, sort]);
  const [rows, publishRows] = useVisibleSnapshot<LibraryBookmark[]>(listOwner, [], clockActive);
  const [collectionRows, publishCollectionRows] = useVisibleSnapshot<LibraryBookmark[]>(listOwner, [], clockActive);
  // A populated feed never changes under a moving finger: publications wait for the feed to rest. Each entry keeps
  // its scope-bound setter, so a publication buffered for a replaced scope stays a no-op when flushed.
  const scrolling = useRef(false), populated = useRef(false), deferred = useRef(new Map<(value: LibraryBookmark[]) => void, LibraryBookmark[]>());
  const setRows = useCallback((value: LibraryBookmark[]) => {if (scrolling.current && populated.current) deferred.current.set(publishRows, value); else publishRows(value);}, [publishRows]);
  const setCollectionRows = useCallback((value: LibraryBookmark[]) => {if (scrolling.current && populated.current) deferred.current.set(publishCollectionRows, value); else publishCollectionRows(value);}, [publishCollectionRows]);
  const [collections, setCollections] = useState<LibraryCollection[]>([]), [activeId, setActiveId] = useState<string | null>(null);
  const [user, setUser] = useState<Record<string, unknown>>({}), [subscription, setSubscription] = useState<Record<string, unknown> | null>(null);
  const [drawer, setDrawer] = useState(false), [sortMenu, setSortMenu] = useState(false), [add, setAdd] = useState(false), [edit, setEdit] = useState<LibraryBookmark | null>(null);
  const [processing, setProcessing] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [continueReading, setContinueReading] = useState<{value: ContinueReadingContext; owner: string; repositories: typeof repositories; preferences: typeof preferences} | null>(null), [now, setNow] = useState(Date.now());
  const visibleContinueReading = dataReady && continueReading?.owner === nativeResourceOwner && continueReading.repositories === repositories && continueReading.preferences === preferences ? continueReading.value : null;
  useEffect(() => {telemetry.track('screen_viewed', {screen_name: 'bookmarks', list_mode: sort === 'archived' ? 'archive' : sort});}, [sort, telemetry]);
  const list = useRef<FlatList<LibraryBookmark>>(null);
  const systemOpenSequence = useRef(0);
  const feedPositions = useMemo(() => ({inbox: new FeedScrollPosition(), rss: new FeedScrollPosition()}), [nativeResourceOwner]);
  const scrollTo = useCallback((offset: number, animated = false) => list.current?.scrollToOffset({offset, animated}), []);
  const inboxScroll = useFeedScrollPosition(feedPositions.inbox, scrollTo, !rssSelected, activeId);
  useEffect(() => {
    inboxScroll.reset(); feedPositions.rss.reset(); feedPositions.rss.source = undefined; setDrawer(false); setAdd(false); setImportingPdf(false);
  }, [nativeResourceOwner, feedPositions, inboxScroll.reset]);
  const collectionSelection = useRef(new CollectionSelection()).current;
  const rss = useMemo(() => new RssController(api, Date.now, () => runtime.getNativeResourceOwner() === nativeResourceOwner, dataReady ? repositories?.rss : undefined), [api, runtime, nativeResourceOwner, dataReady, repositories]);
  const rssState = useSyncExternalStore(rss.subscribe, rss.getSnapshot);
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return;
    globalThis.__SLAX_UI_RSS_STATE__ = {
      ready: rssState.ready, enabled: rssState.enabled, busy: rssState.busy, selected: rssState.selected, error: rssState.error,
      subscriptions: rssState.subscriptions.map(row => ({id: row.id, title: row.title, remark: row.remark})),
      entries: rssState.entries.map(row => ({id: row.id, subscriptionId: row.subscription_id, title: row.title, bookmarkId: row.bookmark_user_uuid})),
    };
    return () => {if (globalThis.__SLAX_UI_RSS_STATE__) globalThis.__SLAX_UI_RSS_STATE__ = undefined;};
  }, [fixtureOnly, rssState]);
  const showError = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)), []);
  const [rowsReady, setRowsReady] = useState(false);
  const interactive = libraryIsInteractive(rowsReady, dataReady, upgrade.status);
  useEffect(() => {if (interactive) {markInteractive(); runtime.markLibraryPresented?.();}}, [interactive, markInteractive, runtime]);
  useEffect(() => {setRowsReady(false);}, [repositories, sort]);
  useEffect(() => {
    if (!repositories) {setRows([]); return;}
    if (!clockActive) return;
    return repositories.library.watch(sort, undefined, values => {setRows(values); setRowsReady(true);}, showError);
  }, [repositories, sort, clockActive, showError, setRows]);
  useEffect(() => repositories?.watchLibraryCollections(setCollections, showError), [repositories, showError]);
  useEffect(() => repositories?.watchLibraryUser(values => setUser(values[0] ?? {}), showError), [repositories, showError]);
  useEffect(() => repositories?.watchSubscription(values => setSubscription(values[0] ?? null), showError), [repositories, showError]);
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
  useEffect(() => {setCollectionRows([]);}, [repositories, active?.ownerId, setCollectionRows]);
  useEffect(() => {if (active && clockActive) return repositories?.library.watch('inbox', active.ownerId, setCollectionRows, showError);}, [repositories, active?.ownerId, clockActive, showError, setCollectionRows]);
  const collectionExpiry = active ? parseSourceTimestamp(active.subscriptionEndTime) : NaN;
  const subscriptionExpiry = parseSourceTimestamp(String(subscription?.subscription_end_time ?? subscription?.end_time ?? ''));
  useEffect(() => {
    if (!clockActive) return;
    const update = () => setNow(previous => {const current = Date.now(); return [collectionExpiry, subscriptionExpiry].some(expiry => (expiry > previous) !== (expiry > current)) ? current : previous;});
    update();
    const timer = setInterval(update, 5000);
    return () => clearInterval(timer);
  }, [clockActive, collectionExpiry, subscriptionExpiry]);
  useFocusEffect(useCallback(() => {
    if (!dataReady || !nativeResourceOwner) {setContinueReading(null); return;}
    let mounted = true;
    const current = () => mounted && runtime.getNativeResourceOwner() === nativeResourceOwner && runtime.getRepositories() === repositories && runtime.getAccountPreferences() === preferences && runtime.getUpgradeSnapshot().status === 'ready';
    if (!current()) return;
    void readContinueReading(preferences).then(async value => {
      if (!current()) return;
      if (!value) {setContinueReading(null); return;}
      await preferences.update(next => {if (current()) delete next.continue_reading_bookmark;});
      if (current() && value.title.trim()) setContinueReading({owner: nativeResourceOwner, repositories, preferences, value: {...value, title: value.title.replace(/\s+/g, ' ').trim()}});
    }).catch(reason => {if (current()) showError(reason);});
    return () => {mounted = false;};
  }, [dataReady, nativeResourceOwner, preferences, repositories, runtime, showError]));
  useEffect(() => {rss.activate(); return () => rss.dispose();}, [rss]);
  useEffect(() => {
    if (!clockActive) return;
    void rss.load();
    const timer = setInterval(() => rss.poll(), 5000);
    return () => {clearInterval(timer); rss.cancel();};
  }, [rss, clockActive]);
  const scrollActivity = useCallback((active: boolean) => runtime.setInteractionBusy?.(active, 'library-scroll'), [runtime]);
  const inboxScrollActivity = useCallback((active: boolean) => {
    scrolling.current = active;
    if (!active && deferred.current.size) {const pending = [...deferred.current]; deferred.current.clear(); for (const [publish, value] of pending) publish(value);}
    scrollActivity(active);
  }, [scrollActivity]);
  useEffect(() => {if (!rssState.enabled) setAddingRss(false);}, [rssState.enabled]);
  useEffect(() => {
    const source = route.params?.source;
    if (!source || !dataReady) return;
    if (source.kind === 'collection') {
      if (!collections.some(value => value.id === source.id)) return;
      setRssSelected(false); void selectCollection(source.id);
    } else {setRssSelected(true); void rss.load().then(() => rss.select(source.id)).catch(showError);}
    navigation.setParams({source: undefined});
  }, [route.params?.source, dataReady, collections, selectCollection, rss, navigation, showError]);
  const closed = active && active.status !== 1, expired = active && !(parseSourceTimestamp(active.subscriptionEndTime) > now);
  const blocked = activeId !== null && (!active || closed || expired);
  const shownRows = !dataReady ? [] : activeId === null ? rows : blocked ? [] : collectionRows;
  const openBookmark = useCallback((item: LibraryBookmark) => {
    if (!dataReady || !nativeResourceOwner || runtime.getNativeResourceOwner() !== nativeResourceOwner || runtime.getRepositories() !== repositories) return;
    if (activeId !== null && active && !blocked) navigation.navigate('Reader', {bookmarkId: item.id, collectionId: active.id, collectionOwnerId: active.ownerId});
    else if (item.status === 'success') {
      navigation.navigate('Reader', {bookmarkId: item.id});
      if (activeId === null) {
        void systemSurfaces?.donateSuccessfulOpen(item.id, `manual-open-${Date.now()}-${++systemOpenSequence.current}`);
      }
    } else setProcessing(item.url);
  }, [dataReady, nativeResourceOwner, runtime, repositories, activeId, active?.id, active?.ownerId, blocked, navigation, systemSurfaces]);
  const renderBookmark = useCallback(({item}: {item: LibraryBookmark}) => <BookmarkRow item={item} sort={activeId ? 'inbox' : sort} owned={activeId === null} t={t} repositories={repositories} telemetry={telemetry} onOpen={openBookmark} onEdit={setEdit} onError={showError} />, [activeId, sort, t, repositories, telemetry, openBookmark, showError]);
  const [headerHeight, setHeaderHeight] = useState<{key: string; height: number} | null>(null);
  const headerKey = `${collections.length > 0}:${active && !blocked && shownRows.length ? `${active.id}:${active.name}` : 'own'}:${window.fontScale}`;
  const measureHeader = useCallback((event: {nativeEvent: {layout: {height: number}}}) => {const height = event.nativeEvent.layout.height; setHeaderHeight(previous => previous?.key === headerKey && previous.height === height ? previous : {key: headerKey, height});}, [headerKey]);
  const getItemLayout = useMemo(() => {
    if (headerHeight?.key !== headerKey) return undefined;
    const header = headerHeight.height;
    // A rendered cell holds its row and the separator after it (none after the last row); VirtualizedList sizes
    // its spacers from these lengths, so they must cover the separator or the spacers drift as cells mount.
    const row = PixelRatio.roundToNearestPixel(L.librarySwipeActionHeight), separator = PixelRatio.roundToNearestPixel(0.5), cell = row + separator;
    return (data: ArrayLike<LibraryBookmark> | null | undefined, index: number) => ({index, length: data && index === data.length - 1 ? row : cell, offset: header + index * cell});
  }, [headerKey, headerHeight]);
  populated.current = shownRows.length > 0;
  const hasRows = shownRows.length > 0, ownerTitle = active && !blocked && hasRows ? active.name : null, avatar = String(user.picture ?? '');
  const listHeader = useMemo(() => <View testID="library-scrolling-header" onLayout={measureHeader}>
            {collections.length > 0 ? <View testID="library-collection-strip" style={[{height: 96, backgroundColor: C.background}, Platform.OS === 'android' && {paddingTop: PixelRatio.roundToNearestPixel(12), paddingBottom: PixelRatio.roundToNearestPixel(16)}]}><ScrollView horizontal scrollsToTop={false} showsHorizontalScrollIndicator={false} style={{flexGrow: 0, height: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(96) - PixelRatio.roundToNearestPixel(12) - PixelRatio.roundToNearestPixel(16) : 96}} contentContainerStyle={[styles.sources, Platform.OS === 'android' && {paddingTop: 0, paddingBottom: 0}]}>
              {[{id: null, name: t('collection_my_inbox'), avatar, hasNew: false}, ...collections].map(source => <Pressable key={source.id ?? 'own'} accessibilityRole="tab" accessibilityState={{selected: activeId === source.id}} onPress={() => {void selectCollection(source.id);}} style={styles.source}><View style={styles.sourceCircle}><View pointerEvents="none" style={StyleSheet.absoluteFill}><SourceCircle size={48} thickness={0.5} border={activeId === source.id ? C.rssSelectedBorder : 'transparent'} /></View><SourceAvatar resourceKey={source.id ? `collection:${source.id}` : 'self'} uri={source.avatar} size={42} label={source.name} />{source.hasNew ? <View pointerEvents="none" style={styles.newDot}><SourceCircle size={9} thickness={1.5} border={C.readerBackground} fill={C.rssAccent} /></View> : null}</View><SourceLine text={source.name} fontSize={11} lineHeight={14} ellipsis="middle" alignment="center" fontWeight={activeId === source.id ? 500 : 400} color={activeId === source.id ? C.text : C.mutedText} style={{marginTop: 6}} /></Pressable>)}
            </ScrollView></View> : null}
            <View style={{height: 8}} />
            {ownerTitle ? <SourceText numberOfLines={1} style={[T.toolbarLabel, {color: C.mutedText, marginHorizontal: 24, marginTop: 4}]}>{t('collection_owner_feed_title', [ownerTitle])}</SourceText> : null}
          </View>, [measureHeader, collections, avatar, activeId, ownerTitle, t, selectCollection]);
  const listEmpty = useMemo(() => activeId !== null && blocked ? <View style={styles.collectionMessage}><SourceText style={[T.metadata, {color: C.rssIconMuted, lineHeight: 22}]}>{!active ? t('collection_unavailable') : closed ? t('collection_closed_message', [active.name]) : t('collection_expired_message', [active.name])}</SourceText></View> : !dataReady || activeId === null && !rowsReady ? <LibraryDataStatus upgrade={upgrade} t={t} retryStart={retryStart} /> : activeId !== null ? <View style={styles.collectionMessage}><SourceText style={[T.metadata, {color: C.rssIconMuted, lineHeight: 22}]}>{t('collection_empty')}</SourceText></View> : <EmptyInbox />, [activeId, blocked, active, closed, dataReady, rowsReady, upgrade, t, retryStart]);
  const listFooter = useMemo(() => hasRows ? <View><Divider inset={24} /><SourceLine text={t('list_no_more')} fontSize={14} lineHeight={20} centerAsGroup color={C.mutedText} style={{marginVertical: 34}} /></View> : undefined, [hasRows, t]);
  const feedContentStyle = useMemo(() => [{paddingBottom: insets.bottom + 16}, !hasRows && {flexGrow: 1}], [insets.bottom, hasRows]);
  const requestRss = useCallback(() => setAddingRss(true), []), dismissRss = useCallback(() => setAddingRss(false), []);
  const openRssSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const openRss = useCallback((entry: {id: string}) => {
    if (dataReady && nativeResourceOwner && runtime.getNativeResourceOwner() === nativeResourceOwner && runtime.getRepositories() === repositories) navigation.navigate('Reader', {bookmarkId: '', rssEntryId: entry.id, openedFrom: 'rss'});
  }, [dataReady, nativeResourceOwner, runtime, repositories, navigation]);
  function openRoute(route: 'Settings' | 'About' | 'Subscription' | 'Feedback') {telemetry.element(`sidebar_${route === 'Settings' ? 'settings' : route.toLowerCase()}_menu_item`, 'bookmarks'); if (route === 'Subscription' && !subscribed && config.platform === 'ios') telemetry.firebase('subscription', 'view', {source: 'screen'}); setDrawer(false); if (route === 'Feedback') navigation.navigate('Feedback', {entryPoint: 'inbox'}); else navigation.navigate(route);}
  const subscribed = Boolean(subscription && String(subscription.subscription_end_time ?? subscription.end_time ?? '') && parseSourceTimestamp(String(subscription.subscription_end_time ?? subscription.end_time)) > now);
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return;
    return fixtureActions.subscribe('library', async action => {
      if (action.kind === 'select-list') {
        if (action.list === 'rss') {await rss.load(); setRssSelected(true);}
        else if (action.list === 'inbox' || action.list === 'starred' || action.list === 'archived') {setRssSelected(false); setSort(action.list);}
        else throw new Error('Unknown fixture list');
        return true;
      }
      if (action.kind === 'select-source') {if (rssSelected) await rss.select(action.id === null ? null : String(action.id)); else {if (action.id !== null && !collections.some(value => value.id === action.id)) throw new Error('Unknown fixture collection'); await selectCollection(action.id as string | null);} return true;}
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
  const sidebar = <ScrollView scrollsToTop={false} style={styles.drawer} contentContainerStyle={{width: '100%', flexGrow: 1, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8, paddingLeft: insets.left + 8, paddingRight: 8}} bounces={false} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="button" accessibilityLabel={t('sidebar_close')} onPress={() => setDrawer(false)} style={{marginLeft: 12, width: 24}} hitSlop={10}><SourceIcon name="ic_xs_sidebar_close" /></Pressable>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: 12, marginVertical: 16}}><SourceAvatar resourceKey="self" uri={String(user.picture ?? '')} label={t('sidebar_user_avatar')} /><SourceText style={{fontSize: 16, lineHeight: 20, fontWeight: '600', flexShrink: 1}}>{String(user.name ?? '')}</SourceText></View>
      <LibrarySyncStatus />
      <View style={{flex: 1}} />
      {!subscribed && config.platform === 'ios' ? <Pressable accessibilityRole="button" onPress={() => openRoute('Subscription')} style={styles.subscription}><SourceIcon name="ic_xs_sidebar_subscribed" size={16} /><SourceText numberOfLines={1} style={{flex: 1, fontSize: 15, lineHeight: 21, color: C.subscriptionText}}>{t('sidebar_subscription')}</SourceText><SourceIcon name="ic_xs_sidebar_yellow_arrow" size={20} /></Pressable> : null}
      {[...(subscribed ? [{route: 'Subscription' as const, label: 'sidebar_subscription', icon: 'ic_xs_sidebar_subscribe' as MobileAssetName}] : []), {route: 'Settings' as const, label: 'sidebar_settings', icon: 'ic_xs_sidebar_config' as MobileAssetName}, {route: 'Feedback' as const, label: 'sidebar_feedback', icon: 'ic_xs_sidebar_feedback' as MobileAssetName}, {route: 'About' as const, label: 'sidebar_about', icon: 'ic_xs_sidebar_about' as MobileAssetName}].map(item => <Pressable key={item.route} accessibilityRole="button" onPress={() => openRoute(item.route)} style={({pressed}) => [styles.drawerItem, {backgroundColor: pressed ? C.pressedOverlay : 'transparent'}]}><SourceIcon name={item.icon} size={20} /><SourceText style={{fontSize: 16, lineHeight: 20, color: C.bodyText}}>{t(item.label)}</SourceText></Pressable>)}
      <Pressable accessibilityRole="button" onPress={() => {telemetry.element('sidebar_logout_menu_item', 'bookmarks'); void sessions.signOut(true, 'user').catch(showError);}} style={styles.drawerItem}><SourceIcon name="ic_xs_sidebar_logout" size={20} /><SourceText style={{fontSize: 16, lineHeight: 20, color: C.bodyText}}>{t('sidebar_logout')}</SourceText></Pressable>
  </ScrollView>;
  return <ScreenSurface bottomInset={false}><SourceDrawer open={drawer} onOpenChange={setDrawer} width={Math.min(window.width, L.drawerMaximumWidth)} drawer={sidebar} testID={IDs.SidebarDrawer}>
    <View style={{flex: 1, paddingLeft: insets.left, paddingRight: insets.right}}>
    <View style={{paddingTop: insets.top}}>
      <View style={styles.navigation}>
        <Pressable accessibilityRole="button" accessibilityLabel="Menu" onPress={() => {telemetry.element('sidebar_open_button', 'bookmarks'); setDrawer(true);}} style={({pressed}) => [styles.navLeft, {opacity: pressed ? 0.5 : 1}]}><SourceIcon name="ic_inbox_tab" /><LibrarySyncAvatar uri={String(user.picture ?? '')} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Switch List" onPress={() => setSortMenu(true)} style={styles.navTitle}><SourceLine text={t(rssSelected ? 'rss_feeds' : sortKeys[sort])} fontSize={17} lineHeight={24} fontWeight={500} color={C.text} alignment="center" fitContent style={{alignSelf: 'center'}} /><SourceIcon name="inbox_more" size={10} /></Pressable>
        <View style={{flexDirection: 'row', alignItems: 'center', paddingRight: 12}}><Pressable accessibilityRole="button" accessibilityLabel={t('search_action')} onPress={() => navigation.navigate('Search')} style={{minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'}}><SearchGlyph/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Add Link" disabled={!repositories} accessibilityState={{disabled: !repositories}} onPress={() => {telemetry.element('bookmark_add_button', 'bookmarks'); rssSelected ? setAddingRss(true) : setAdd(true);}} style={({pressed}) => [{minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'}, {opacity: pressed ? 0.5 : 1}]}><SourceIcon name="ic_xs_inbox_add" /></Pressable></View>
      </View>
      {Platform.OS === 'android' ? <Pressable accessible={false} style={{position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 10}} onPress={() => inboxScroll.reset(true)} /> : null}
    </View>
    <SourceShape radius={16} corners="top" fillColor={C.readerBackground} style={[styles.feed, Platform.OS === 'android' && {backgroundColor: 'transparent', borderTopLeftRadius: 0, borderTopRightRadius: 0, overflow: 'visible'}]}>
      {rssSelected ? !dataReady ? <LibraryDataStatus upgrade={upgrade} t={t} retryStart={retryStart} /> : <RssFeed key={nativeResourceOwner} active={clockActive} scrollsToTop={!drawer} onScrollActivity={scrollActivity} state={rssState} controller={rss} scrollPosition={feedPositions.rss} adding={addingRss} onDismissAdd={dismissRss} onRequestAdd={requestRss} onOpenSettings={openRssSettings} onOpen={openRss} header={rssState.enabled ? <View style={{backgroundColor: C.background}}><RssFeedSwitcher state={rssState} controller={rss} onAdd={requestRss} /></View> : null} /> : <>
        <FeedList key={JSON.stringify([nativeResourceOwner, activeId])} ref={list} {...inboxScroll.events} contentScope={sort} active={clockActive && !drawer} onScrollActivity={inboxScrollActivity} data={shownRows} keyExtractor={bookmarkKey} getItemLayout={getItemLayout} initialNumToRender={16} contentContainerStyle={feedContentStyle}
          ListHeaderComponent={listHeader}
          renderItem={renderBookmark}
          ItemSeparatorComponent={FeedDivider}
          ListEmptyComponent={listEmpty}
          ListFooterComponent={listFooter} />
        {activeId === null && visibleContinueReading ? <ContinueBanner value={visibleContinueReading} bottom={insets.bottom} onDismiss={() => setContinueReading(null)} onOpen={() => {
          if (!dataReady || !nativeResourceOwner || runtime.getNativeResourceOwner() !== nativeResourceOwner || runtime.getRepositories() !== repositories || runtime.getAccountPreferences() !== preferences || runtime.getUpgradeSnapshot().status !== 'ready') return;
          telemetry.element('continue_reading_button', 'bookmarks'); navigation.navigate('Reader', {bookmarkId: visibleContinueReading.bookmarkId, collectionOwnerId: visibleContinueReading.collectionOwnerId ?? undefined, collectionId: visibleContinueReading.collectionId ?? undefined, openedFrom: 'bookmarks'});
        }} /> : null}
      </>}
    </SourceShape>
    <SourceMenu visible={sortMenu} anchor={{x: insets.left + (window.width - insets.left - insets.right - 200) / 2, y: insets.top + 52}} onDismiss={() => setSortMenu(false)} items={[...(['inbox', 'starred', 'archived'] as const).map(value => ({label: t(sortKeys[value]), selected: !rssSelected && value === sort, onPress: () => {telemetry.element('inbox_sort_control', 'bookmarks'); setRssSelected(false); setSort(value);}})), ...(rssState.enabled ? [{label: t('rss_feeds'), selected: rssSelected, onPress: () => {telemetry.element('inbox_rss_control', 'bookmarks'); setRssSelected(true);}}] : [])]} />
    <LinkInputDialog visible={add} onDismiss={() => setAdd(false)} onImportPdf={pdfLab.ready && pdfLab.enabled ? () => setImportingPdf(true) : undefined} onSubmit={url => {telemetry.firebase('bookmark', 'add_start', {channel: 'app', method: 'manual_paste'}); void repositories?.createBookmark(url).then(() => inboxScroll.reset(true)).catch(showError);}} />
    <PdfImportDialog key={`pdf-import-${nativeResourceOwner}`} visible={importingPdf} onDismiss={() => setImportingPdf(false)} onSaved={bookmarkId => {inboxScroll.reset(true); navigation.navigate('Reader', {bookmarkId});}} />
    <LinkInputDialog visible={edit !== null} initialTitle={edit ? edit.aliasTitle || edit.title : undefined} onDismiss={() => setEdit(null)} onSubmit={title => {if (edit) void repositories?.updateBookmark(edit.id, {aliasTitle: title}).catch(showError);}} />
    <SourceDialog compact visible={processing !== null} onDismiss={() => setProcessing(null)}><View style={{alignItems: 'flex-end'}}><Pressable accessibilityLabel={t('btn_close')} onPress={() => setProcessing(null)}><SourceIcon name="ic_xs_dialog_close" /></Pressable></View><SourceText style={[T.menu, {color: C.bodyText, marginTop: 20}]}>{t('processing_message')}</SourceText><SourceButton label={t('processing_btn_read_original')} style={{marginTop: 24}} onPress={() => {const url = processing; setProcessing(null); if (fixtureOnly) {showError(new Error('External browser navigation has no prepared fixture provider')); return;} if (url && /^https?:\/\//.test(url)) void Linking.openURL(url).catch(showError);}} /></SourceDialog>
    <SourceDialog visible={error !== null} title={t('feedback_error_title')} onDismiss={() => setError(null)} actions={<TextAction label={t('btn_ok')} onPress={() => setError(null)} />}><SourceText>{error}</SourceText></SourceDialog>
    </View>
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
const styles = StyleSheet.create({navigation: {minHeight: 24 + 2 * PixelRatio.roundToNearestPixel(10), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, navLeft: {paddingLeft: 24, paddingVertical: PixelRatio.roundToNearestPixel(10), flexDirection: 'row', gap: 6, alignItems: 'center'}, navTitle: {position: 'absolute', left: 90, right: 90, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(4) : 4, paddingVertical: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(5) : 5}, navAdd: {paddingHorizontal: 24, paddingVertical: PixelRatio.roundToNearestPixel(10)}, sources: {paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: PixelRatio.roundToNearestPixel(12)}, source: {width: 72, alignItems: 'center'}, sourceCircle: {width: 48, height: 48, borderRadius: 24, padding: 3, alignItems: 'center', justifyContent: 'center'}, newDot: {position: 'absolute', right: PixelRatio.roundToNearestPixel(2), top: PixelRatio.roundToNearestPixel(2), height: PixelRatio.roundToNearestPixel(9), width: PixelRatio.roundToNearestPixel(9)}, feed: {flex: 1, backgroundColor: C.readerBackground, borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden'}, collectionMessage: {flex: 1, padding: 32, justifyContent: 'center'}, drawer: {flex: 1, backgroundColor: C.background}, drawerItem: {minHeight: 56, borderRadius: 12, flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16}, subscription: {alignSelf: 'stretch', marginHorizontal: 16, marginVertical: 20, minHeight: 36, paddingHorizontal: 12, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden', experimental_backgroundImage: `linear-gradient(to right, ${C.subscriptionGradientStart}, ${C.subscriptionGradientEnd})`}, empty: {transform: [{translateY: -65}], marginHorizontal: 30, maxWidth: 315, alignItems: 'center', alignSelf: 'stretch'}, continueArea: {position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 8, paddingTop: 13, experimental_backgroundImage: 'linear-gradient(to bottom, #FCFCFC00, #FCFCFCE6, #FCFCFC)'}, continue: {flexDirection: 'row', alignItems: 'center', gap: Platform.OS === 'android' ? PixelRatio.roundToNearestPixel(6) : 6, borderRadius: 16, padding: 16, backgroundColor: C.surface, ...Platform.select({android: {elevation: 40, shadowColor: '#00000014'}, default: {boxShadow: [{offsetX: 0, offsetY: 20, blurRadius: 40, color: '#00000004'}]}})}, continueBorder: {borderRadius: 16, borderWidth: 1, borderColor: C.border}});
