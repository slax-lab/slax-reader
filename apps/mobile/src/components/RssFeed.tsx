import type {ViewInstance} from 'react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, PixelRatio, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import type { RssEntry, RssSubscription } from '@slax-reader/contracts';
import { useMobile } from '../runtime';
import { rssDisplayName, type RssController, type RssState } from '../rss/controller';
import { mobileColors as C, mobileTypography as T } from '../theme';
import { AppImage } from './AppImage';
import { SourceButton, SourceDialog, SourceIcon, SourceSheet, SourceText, SourceProgress, TextAction, Divider } from './SourceUI';
import { SourceMenu } from './SourceMenu';
import {fixtureActions} from './fixture-actions';
import {FeedScrollPosition, useFeedScrollPosition} from './feed-scroll';

export function rssImage(raw?: string | null): string | null {
  if (!raw) return null;
  try {const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && url.searchParams.get('m') === 'rss' && Boolean(url.searchParams.get('d')) ? raw : null;} catch {return null;}
}
export function rssSourceText(name: string) {
  const first = name.search(/\p{L}/u); if (first < 0) return 'RSS';
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(name[first])) return name[first];
  return name.slice(first).match(/^[\p{L}\p{M}]+/u)?.[0].split(/[\u3400-\u9fff\uf900-\ufaff]/)[0] || 'RSS';
}
function SafeRssImage({url, size, sourceName}: {url?: string | null; size: number; sourceName?: string}) {
  const {fixtureOnly, cache, nativeResourceOwner} = useMobile(), remote = rssImage(url);
  const key = `${nativeResourceOwner ?? ''}:${remote ?? ''}`;
  const [resolved, setResolved] = useState<{key: string; uri: string | null} | null>(null);
  useEffect(() => {
    if (!cache || !remote) return;
    const controller = new AbortController();
    const work = fixtureOnly ? cache.getResourceUri('rss-fixture', remote) : cache.ensureImage('rss-images', remote, undefined, controller.signal);
    void work.then(uri => {if (!controller.signal.aborted) setResolved({key, uri});}, () => {if (!controller.signal.aborted) setResolved({key, uri: null});});
    return () => controller.abort();
  }, [cache, remote, key, fixtureOnly]);
  return <RssImageTransport key={key} uri={resolved?.key === key ? resolved.uri : null} size={size} sourceName={sourceName} />;
}
function RssImageTransport({uri, size, sourceName}: {uri: string | null; size: number; sourceName?: string}) {
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  const text = sourceName ? rssSourceText(sourceName) : null;
  return <View style={[styles.image, {width: size, height: size, borderRadius: sourceName ? size / 2 : 10}]}>
    {!loaded ? text ? <SourceText numberOfLines={1} style={{color: C.rssAccent, fontSize: text.length === 1 ? 20 : 10}}>{text}</SourceText> : <SourceIcon name="ic_rss" size={size > 60 ? 28 : 24} /> : null}
    {uri && !failed ? <AppImage source={uri} maxPixels={Math.ceil(size * PixelRatio.get()) ** 2} fit={sourceName ? 'contain' : 'cover'} onLoad={() => setLoaded(true)} onError={() => {setFailed(true); setLoaded(false);}} style={[StyleSheet.absoluteFill, {borderRadius: sourceName ? size / 2 : 10}]} /> : null}
  </View>;
}
export function RssFeedSwitcher({state, controller, onAdd}: {state: RssState; controller: RssController; onAdd(): void}) {
  const {t} = useMobile();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow: 0, height: 96}} contentContainerStyle={styles.switcher}>
    {state.subscriptions.map(source => <Pressable key={source.id} accessibilityRole="tab" accessibilityState={{selected: state.selected === source.id, disabled: state.busy}} disabled={state.busy} onPress={() => void controller.select(source.id)} style={styles.source}>
      <View style={[styles.sourceCircle, {borderColor: state.selected === source.id ? C.rssSelectedBorder : 'transparent'}]}><SafeRssImage url={source.icon_url} size={41} sourceName={rssDisplayName(source)} /></View>
      <SourceText numberOfLines={1} ellipsizeMode="middle" style={[T.rssSourceLabel, {marginTop: 6, fontWeight: state.selected === source.id ? '500' : '400', color: state.selected === source.id ? C.text : C.mutedText}]}>{rssDisplayName(source)}</SourceText>
    </Pressable>)}
    <Pressable accessibilityRole="button" accessibilityLabel={t('rss_add_source')} onPress={onAdd} style={styles.source}><View style={[styles.sourceCircle, {backgroundColor: '#EDEAE5'}]}><SourceIcon name="ic_xs_inbox_add" size={22} style={{tintColor: C.rssIconMuted}} /></View><SourceText numberOfLines={1} style={[T.rssSourceLabel, {color: C.mutedText, marginTop: 6}]}>{t('rss_add_source')}</SourceText></Pressable>
  </ScrollView>;
}
function displayTime(raw: string) { const date = new Date(raw); if (!Number.isFinite(date.getTime())) return ''; const pad = (v: number) => String(v).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`; }
export function RssFeed({state, controller, adding, onDismissAdd, onRequestAdd, onOpenSettings, onOpen, scrollPosition, active = true, header}: {state: RssState; controller: RssController; adding: boolean; onDismissAdd(): void; onRequestAdd(): void; onOpenSettings(): void; onOpen(entry: RssEntry): void; scrollPosition: FeedScrollPosition; active?: boolean; header?: React.ReactNode}) {
  const {t, fixtureOnly} = useMobile(); const list = useRef<FlatList<RssEntry>>(null), toolbar = useRef<ViewInstance>(null);
  const scrollTo = useCallback((offset: number, animated = false) => list.current?.scrollToOffset({offset, animated}), []);
  const scroll = useFeedScrollPosition(scrollPosition, scrollTo, true, state.selected);
  const [editing, setEditing] = useState<RssSubscription | null>(null), [removing, setRemoving] = useState<RssSubscription | null>(null), [menu, setMenu] = useState(false), [anchor, setAnchor] = useState({x: 0, y: 0}), [now, setNow] = useState(Date.now());
  const current = state.subscriptions.find(item => item.id === state.selected);
  const refreshAt = Date.parse(current?.next_allowed_at ?? ''), retryAt = Date.parse(state.retryAt ?? '');
  useEffect(() => {
    if (!active || !state.enabled) return;
    const update = () => setNow(previous => {const next = Date.now(); return [refreshAt, retryAt].some(deadline => (deadline > previous) !== (deadline > next)) ? next : previous;});
    update();
    if (![refreshAt, retryAt].some(deadline => deadline > Date.now())) return;
    const timer = setInterval(update, 5000); return () => clearInterval(timer);
  }, [active, state.enabled, refreshAt, retryAt]);
  useEffect(() => {
    const changed = scrollPosition.source !== undefined && scrollPosition.source !== state.selected;
    scrollPosition.select(state.selected);
    if (changed) scroll.reset();
    setMenu(false);
  }, [state.selected, scrollPosition, scroll.reset]);
  useEffect(() => {if (!state.enabled) {onDismissAdd(); setEditing(null); setRemoving(null);}}, [state.enabled, onDismissAdd]);
  const canRefresh = Boolean(current && !state.busy && !current.refreshing && refreshAt <= now);
  const renderEntry = useCallback(({item}: {item: RssEntry}) => <RssEntryRow entry={item} busy={state.busy} t={t} controller={controller} onOpen={onOpen} />, [state.busy, t, controller, onOpen]);
  const openMenu = useCallback(() => {toolbar.current?.measureInWindow((x, y, width) => {setAnchor({x: x + width - 200, y: y + 40}); setMenu(true);});}, []);
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return;
    return fixtureActions.subscribe('rss-feed', action => {
      if (action.kind !== 'source-menu') return false;
      if (!current) throw new Error('A fixture RSS source must be selected');
      openMenu(); return true;
    });
  }, [fixtureOnly, current]);
  return <View style={{flex: 1, backgroundColor: C.readerBackground}}>
    <FlatList key={state.selected} ref={list} {...scroll.events} maintainVisibleContentPosition={{minIndexForVisible: 0}} data={state.enabled ? state.entries : []} keyExtractor={entry => entry.id} contentContainerStyle={{paddingBottom: 16}}
      ListHeaderComponent={<>
        {header}
        {state.busy ? <SourceProgress height={2} color={C.rssAccent} /> : null}
        {state.error ? <View style={{paddingHorizontal: 24, paddingVertical: 12}}><SourceText style={[T.metadata, {color: C.danger}]}>{t(`rss_error_${state.error}`)}</SourceText><TextAction label={t('rss_retry')} onPress={() => void controller.load()} disabled={state.busy} /></View> : null}
        {!state.enabled && state.ready && !state.busy ? <TextAction label={t('rss_open_settings')} onPress={onOpenSettings} /> : null}
        {state.enabled && current ? <View ref={toolbar} style={styles.toolbar}><Pressable accessibilityRole="button" accessibilityLabel={t('rss_refresh')} disabled={!canRefresh} onPress={() => void controller.refresh(current.id)} style={{padding: 12, opacity: canRefresh ? 1 : 0.4}}><SourceIcon name="ic_rss_refresh" size={20} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t('rss_source_menu')} onPress={openMenu} style={{padding: 12}}><SourceIcon name="ic_floating_panel_more" size={20} /></Pressable></View> : null}
        {current?.error ? <SourceText style={{fontSize: 12, color: C.danger, marginHorizontal: 24}}>{t(`rss_error_${current.error}`)}</SourceText> : null}
      </>}
      ListEmptyComponent={state.enabled && !state.busy ? <View style={styles.empty}><SourceIcon name="ic_rss" size={36} /><SourceText style={[T.metadata, {color: C.mutedText, textAlign: 'center'}]}>{t(state.subscriptions.length ? 'rss_empty' : 'rss_no_sources')}</SourceText>{!state.subscriptions.length ? <TextAction label={t('rss_add')} color={C.rssAccent} onPress={onRequestAdd} /> : null}</View> : undefined}
      renderItem={renderEntry}
      ItemSeparatorComponent={RssDivider}
      ListFooterComponent={state.enabled && state.hasMore ? <View style={{alignItems: 'center', padding: 24}}><TextAction label={t('rss_more')} disabled={state.busy || Boolean(state.retryAt && Date.parse(state.retryAt) > now)} onPress={() => void controller.more()} />{state.historyStatus === 'retry' || state.historyStatus === 'loading' ? <SourceText style={{fontSize: 12, color: C.mutedText}}>{t(state.historyStatus === 'retry' ? 'rss_history_retry' : 'rss_history_loading')}</SourceText> : null}</View> : state.enabled && state.entries.length && !state.busy ? <SourceText style={[T.metadata, {color: C.mutedText, marginHorizontal: 24, marginVertical: 34}]}>{t('rss_history_end')}</SourceText> : undefined} />
    {current ? <SourceMenu visible={menu} anchor={anchor} onDismiss={() => setMenu(false)} items={[{label: t(current.refreshing ? 'rss_refreshing' : 'rss_refresh'), disabled: !canRefresh, onPress: () => void controller.refresh(current.id)}, {label: t('rss_edit'), disabled: state.busy, onPress: () => setEditing(current)}, {label: t('rss_remove'), disabled: state.busy, onPress: () => setRemoving(current)}]} /> : null}
    <RssEditor visible={adding && state.enabled} controller={controller} state={state} onDismiss={onDismissAdd} />
    <RssEditor visible={Boolean(editing)} source={editing ?? undefined} controller={controller} state={state} onDismiss={() => setEditing(null)} />
    <SourceDialog visible={Boolean(removing)} title={t('rss_remove')} onDismiss={() => setRemoving(null)} actions={<><TextAction label={t('rss_cancel')} onPress={() => setRemoving(null)} /><TextAction label={t('rss_remove')} disabled={state.busy} onPress={() => {if (removing) void controller.remove(removing.id); setRemoving(null);}} /></>}><SourceText>{removing ? rssDisplayName(removing) : ''}{'\n'}{t('rss_remove_hint')}</SourceText></SourceDialog>
  </View>;
}
function RssDivider() {return <Divider inset={24} />;}
const RssEntryRow = React.memo(function RssEntryRow({entry, busy, t, controller, onOpen}: {entry: RssEntry; busy: boolean; t: ReturnType<typeof useMobile>['t']; controller: RssController; onOpen(entry: RssEntry): void}) {
  return <View style={styles.article}><Pressable accessibilityRole="button" onPress={() => onOpen(entry)} style={styles.articleMain}><View style={{flex: 1, gap: 6}}><SourceText numberOfLines={1} style={styles.meta}>{entry.source_title} · {displayTime(entry.published_at ?? entry.first_seen_at)}</SourceText><SourceText numberOfLines={2} style={[T.rowTitle, {fontWeight: '500'}]}>{entry.title}</SourceText>{entry.summary.trim() ? <SourceText numberOfLines={2} style={{fontSize: 13, lineHeight: 20, color: C.rssIconMuted}}>{entry.summary}</SourceText> : null}</View><View style={{paddingTop: 4}}><SafeRssImage url={entry.image_url} size={84} /></View></Pressable><View style={styles.save}><SourceText numberOfLines={1} style={[styles.meta, {flex: 1}]}>{entry.author ?? ''}</SourceText><Pressable disabled={busy || Boolean(entry.bookmark_user_uuid) || !entry.article_url} accessibilityRole="button" accessibilityLabel={t(entry.bookmark_user_uuid ? 'rss_saved' : 'rss_save')} onPress={() => void controller.save(entry)} style={{flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 12}}><SourceIcon name={entry.bookmark_user_uuid ? 'ic_xs_tick_gray_outline_icon' : 'ic_rss_save'} size={14} /><SourceText style={{fontSize: 12, color: busy || entry.bookmark_user_uuid || !entry.article_url ? C.mutedText : C.rssAccent}}>{t(entry.bookmark_user_uuid ? 'rss_saved' : 'rss_save')}</SourceText></Pressable></View></View>;
});
function RssEditor({visible, source, controller, state, onDismiss}: {visible: boolean; source?: RssSubscription; controller: RssController; state: RssState; onDismiss(): void}) {
  const {t} = useMobile(); const [url, setUrl] = useState(''), [name, setName] = useState('');
  useEffect(() => {if (visible && source) {setUrl(source.feed_url); setName(source.remark ?? '');}}, [visible, source]);
  useEffect(() => {if (!state.enabled) {setUrl(''); setName('');}}, [state.enabled]);
  return <SourceSheet visible={visible} busy={state.busy} onDismiss={onDismiss}><SourceText style={{fontSize: 20, fontWeight: '600'}}>{t(source ? 'rss_edit' : 'rss_add')}</SourceText>
    <RssOutlinedField key={`url-${visible}`} label={t('rss_url')} value={url} onChangeText={source ? undefined : setUrl} maxLength={2048} busy={state.busy} placeholder="https://example.com/feed.xml" url />
    <RssOutlinedField key={`name-${visible}`} label={t('rss_name')} value={name} onChangeText={setName} maxLength={120} busy={state.busy} supportingText={t('rss_name_hint')} />
    {state.error ? <SourceText style={{fontSize: 13, color: C.danger}}>{t(`rss_error_${state.error}`)}</SourceText> : null}
    <SourceButton tone="rss" label={t(source ? 'rss_save_name' : 'rss_add')} busy={state.busy} disabled={state.busy || !url.trim()} onPress={() => {void (source ? controller.edit(source.id, name) : controller.add(url, name)).then(ok => {if (ok) {setUrl(''); setName(''); onDismiss();}});}} style={{minHeight: 48}} textStyle={{fontSize: 15}} />
  </SourceSheet>;
}
function RssOutlinedField({label, value, onChangeText, maxLength, busy, placeholder, supportingText, url}: {label: string; value: string; onChangeText?: (value: string) => void; maxLength: number; busy: boolean; placeholder?: string; supportingText?: string; url?: boolean}) {
  const [focused, setFocused] = useState(false), floating = focused || Boolean(value);
  return <View>
    <View style={{paddingTop: 8}}>
      <View style={[styles.field, {opacity: busy ? 0.38 : 1}]}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, {borderRadius: 12, borderColor: !busy && focused ? C.rssAccent : C.switchOff, borderWidth: !busy && focused ? 2 : 1}]} />
        {onChangeText ? <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} maxLength={maxLength} editable={!busy} multiline={false} autoCapitalize={url ? 'none' : 'sentences'} autoCorrect={!url} placeholder={focused ? placeholder : undefined} placeholderTextColor={C.rssIconMuted} selectionColor={C.rssAccent} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={styles.input} /> : <ScrollView horizontal scrollEnabled={!busy} showsHorizontalScrollIndicator={false} style={{flexGrow: 0}}><SourceText accessibilityLabel={label} accessibilityValue={{text: value}} accessibilityState={{disabled: busy}} selectable={!busy} numberOfLines={1} style={styles.input}>{value}</SourceText></ScrollView>}
      </View>
      <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.fieldLabel, floating ? {top: 0, left: 12, paddingHorizontal: 4, backgroundColor: C.readerBackground} : {top: 24, left: 16}]}><SourceText style={{fontSize: floating ? 12 : 16, lineHeight: floating ? 16 : 24, color: !busy && focused ? C.rssAccent : C.rssIconMuted, opacity: busy ? 0.38 : 1}}>{label}</SourceText></View>
    </View>
    {supportingText ? <SourceText style={{fontSize: 12, lineHeight: 16, color: C.rssIconMuted, marginTop: 4, marginHorizontal: 16}}>{supportingText}</SourceText> : null}
  </View>;
}
const styles = StyleSheet.create({switcher: {paddingLeft: 20, paddingRight: 20, paddingTop: 12, paddingBottom: 16, gap: 12}, source: {width: 72, alignItems: 'center'}, sourceCircle: {width: 48, height: 48, borderRadius: 24, borderWidth: 0.5, padding: 3, alignItems: 'center', justifyContent: 'center'}, image: {backgroundColor: '#F3EAE0', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'}, toolbar: {minHeight: 48, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingLeft: 24, paddingRight: 12}, empty: {alignItems: 'center', gap: 16, paddingHorizontal: 32, paddingVertical: 48}, article: {paddingHorizontal: 24, paddingVertical: 14}, articleMain: {flexDirection: 'row', gap: 12}, meta: {fontSize: 11, color: C.mutedText}, save: {flexDirection: 'row', alignItems: 'center'}, field: {minHeight: 56, borderRadius: 12, justifyContent: 'center'}, fieldLabel: {position: 'absolute'}, input: {...T.body, color: C.text, paddingHorizontal: 16, paddingVertical: 16, includeFontPadding: false}});
