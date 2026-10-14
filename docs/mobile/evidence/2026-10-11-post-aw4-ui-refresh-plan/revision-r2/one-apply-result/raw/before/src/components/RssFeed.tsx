import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import type { RssEntry, RssSubscription } from '@slax-reader/contracts';
import { useMobile } from '../runtime';
import { rssDisplayName, type RssController, type RssState } from '../rss/controller';
import { mobileColors as C, mobileTypography as T } from '../theme';
import { SourceButton, SourceDialog, SourceIcon, SourceSheet, SourceText, SourceProgress, TextAction, Divider } from './SourceUI';
import { SourceMenu } from './SourceMenu';
import {fixtureActions} from './fixture-actions';

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
  const {fixtureOnly, cache} = useMobile(), remote = rssImage(url);
  const prepared = fixtureOnly && remote ? cache?.imageFile('rss-fixture', remote) : null;
  const uri = fixtureOnly ? prepared?.exists ? prepared.uri : null : remote;
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {setLoaded(false); setFailed(false);}, [uri]);
  const text = sourceName ? rssSourceText(sourceName) : null;
  return <View style={[styles.image, {width: size, height: size, borderRadius: sourceName ? size / 2 : 10}]}>
    {!loaded ? text ? <SourceText numberOfLines={1} style={{color: C.rssAccent, fontSize: text.length === 1 ? 20 : 10}}>{text}</SourceText> : <SourceIcon name="ic_rss" size={size > 60 ? 28 : 24} /> : null}
    {uri && !failed ? <Image source={{uri}} resizeMode={sourceName ? 'contain' : 'cover'} onLoad={() => setLoaded(true)} onError={() => {setFailed(true); setLoaded(false);}} style={[StyleSheet.absoluteFill, {borderRadius: sourceName ? size / 2 : 10}]} /> : null}
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
export function RssFeed({state, controller, adding, onDismissAdd, onRequestAdd, onOpenSettings, onOpen}: {state: RssState; controller: RssController; adding: boolean; onDismissAdd(): void; onRequestAdd(): void; onOpenSettings(): void; onOpen(entry: RssEntry): void}) {
  const {t, fixtureOnly} = useMobile(); const list = useRef<FlatList<RssEntry>>(null), toolbar = useRef<View>(null);
  const [editing, setEditing] = useState<RssSubscription | null>(null), [removing, setRemoving] = useState<RssSubscription | null>(null), [menu, setMenu] = useState(false), [anchor, setAnchor] = useState({x: 0, y: 0}), [now, setNow] = useState(Date.now());
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer);}, []);
  useEffect(() => {list.current?.scrollToOffset({offset: 0, animated: false}); setMenu(false);}, [state.selected]);
  useEffect(() => {if (!state.enabled) {onDismissAdd(); setEditing(null); setRemoving(null);}}, [state.enabled, onDismissAdd]);
  const current = state.subscriptions.find(item => item.id === state.selected);
  const canRefresh = Boolean(current && !state.busy && !current.refreshing && Date.parse(current.next_allowed_at) <= now);
  function openMenu() {toolbar.current?.measureInWindow((x, y, width) => {setAnchor({x: x + width - 200, y: y + 40}); setMenu(true);});}
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return;
    return fixtureActions.subscribe('rss-feed', action => {
      if (action.kind !== 'source-menu') return false;
      if (!current) throw new Error('A fixture RSS source must be selected');
      openMenu(); return true;
    });
  }, [fixtureOnly, current]);
  return <View style={{flex: 1, backgroundColor: C.readerBackground}}>
    <FlatList ref={list} data={state.enabled ? state.entries : []} keyExtractor={entry => entry.id} contentContainerStyle={{paddingBottom: 16}}
      ListHeaderComponent={<>
        {state.busy ? <SourceProgress height={2} color={C.rssAccent} /> : null}
        {state.error ? <View style={{paddingHorizontal: 24, paddingVertical: 12}}><SourceText style={[T.metadata, {color: C.danger}]}>{t(`rss_error_${state.error}`)}</SourceText><TextAction label={t('rss_retry')} onPress={() => void controller.load()} disabled={state.busy} /></View> : null}
        {!state.enabled && state.ready && !state.busy ? <TextAction label={t('rss_open_settings')} onPress={onOpenSettings} /> : null}
        {state.enabled ? <View ref={toolbar} style={styles.toolbar}>{current ? <><Pressable accessibilityRole="button" accessibilityLabel={t('rss_refresh')} disabled={!canRefresh} onPress={() => void controller.refresh(current.id)} style={{padding: 12, opacity: canRefresh ? 1 : 0.4}}><SourceIcon name="ic_rss_refresh" size={20} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t('rss_source_menu')} onPress={openMenu} style={{padding: 12}}><SourceIcon name="ic_floating_panel_more" size={20} /></Pressable></> : null}</View> : null}
        {current?.error ? <SourceText style={{fontSize: 12, color: C.danger, marginHorizontal: 24}}>{t(`rss_error_${current.error}`)}</SourceText> : null}
      </>}
      ListEmptyComponent={state.enabled && !state.busy ? <View style={styles.empty}><SourceIcon name="ic_rss" size={36} /><SourceText style={[T.metadata, {color: C.mutedText, textAlign: 'center'}]}>{t(state.subscriptions.length ? 'rss_empty' : 'rss_no_sources')}</SourceText>{!state.subscriptions.length ? <TextAction label={t('rss_add')} color={C.rssAccent} onPress={onRequestAdd} /> : null}</View> : null}
      renderItem={({item: entry}) => <View style={styles.article}><Pressable accessibilityRole="button" onPress={() => onOpen(entry)} style={styles.articleMain}><View style={{flex: 1, gap: 6}}><SourceText numberOfLines={1} style={styles.meta}>{entry.source_title} · {displayTime(entry.published_at ?? entry.first_seen_at)}</SourceText><SourceText numberOfLines={2} style={[T.rowTitle, {fontWeight: '500'}]}>{entry.title}</SourceText>{entry.summary.trim() ? <SourceText numberOfLines={2} style={{fontSize: 13, lineHeight: 20, color: C.rssIconMuted}}>{entry.summary}</SourceText> : null}</View><View style={{paddingTop: 4}}><SafeRssImage url={entry.image_url} size={84} /></View></Pressable><View style={styles.save}><SourceText numberOfLines={1} style={[styles.meta, {flex: 1}]}>{entry.author ?? ''}</SourceText><Pressable disabled={state.busy || Boolean(entry.bookmark_user_uuid) || !entry.article_url} accessibilityRole="button" accessibilityLabel={t(entry.bookmark_user_uuid ? 'rss_saved' : 'rss_save')} onPress={() => void controller.save(entry)} style={{flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 12}}><SourceIcon name={entry.bookmark_user_uuid ? 'ic_xs_tick_gray_outline_icon' : 'ic_rss_save'} size={14} /><SourceText style={{fontSize: 12, color: state.busy || entry.bookmark_user_uuid || !entry.article_url ? C.mutedText : C.rssAccent}}>{t(entry.bookmark_user_uuid ? 'rss_saved' : 'rss_save')}</SourceText></Pressable></View></View>}
      ItemSeparatorComponent={() => <Divider inset={24} />}
      ListFooterComponent={state.enabled && state.hasMore ? <View style={{alignItems: 'center', padding: 24}}><TextAction label={t('rss_more')} disabled={state.busy || Boolean(state.retryAt && Date.parse(state.retryAt) > now)} onPress={() => void controller.more()} />{state.historyStatus === 'retry' || state.historyStatus === 'loading' ? <SourceText style={{fontSize: 12, color: C.mutedText}}>{t(state.historyStatus === 'retry' ? 'rss_history_retry' : 'rss_history_loading')}</SourceText> : null}</View> : state.enabled && state.entries.length && !state.busy ? <SourceText style={[T.metadata, {color: C.mutedText, marginHorizontal: 24, marginVertical: 34}]}>{t('rss_history_end')}</SourceText> : null} />
    {current ? <SourceMenu visible={menu} anchor={anchor} onDismiss={() => setMenu(false)} items={[{label: t(current.refreshing ? 'rss_refreshing' : 'rss_refresh'), disabled: !canRefresh, onPress: () => void controller.refresh(current.id)}, {label: t('rss_edit'), disabled: state.busy, onPress: () => setEditing(current)}, {label: t('rss_remove'), disabled: state.busy, onPress: () => setRemoving(current)}]} /> : null}
    <RssEditor visible={adding && state.enabled} controller={controller} state={state} onDismiss={onDismissAdd} />
    <RssEditor visible={Boolean(editing)} source={editing ?? undefined} controller={controller} state={state} onDismiss={() => setEditing(null)} />
    <SourceDialog visible={Boolean(removing)} title={t('rss_remove')} onDismiss={() => setRemoving(null)} actions={<><TextAction label={t('rss_cancel')} onPress={() => setRemoving(null)} /><TextAction label={t('rss_remove')} disabled={state.busy} onPress={() => {if (removing) void controller.remove(removing.id); setRemoving(null);}} /></>}><SourceText>{removing ? rssDisplayName(removing) : ''}{'\n'}{t('rss_remove_hint')}</SourceText></SourceDialog>
  </View>;
}
function RssEditor({visible, source, controller, state, onDismiss}: {visible: boolean; source?: RssSubscription; controller: RssController; state: RssState; onDismiss(): void}) {
  const {t} = useMobile(); const [url, setUrl] = useState(''), [name, setName] = useState('');
  useEffect(() => {if (visible) {setUrl(source?.feed_url ?? ''); setName(source?.remark ?? '');}}, [visible, source]);
  return <SourceSheet visible={visible} busy={state.busy} onDismiss={onDismiss}><SourceText style={{fontSize: 20, fontWeight: '600'}}>{t(source ? 'rss_edit' : 'rss_add')}</SourceText>
    <View><SourceText style={T.metadata}>{t('rss_url')}</SourceText><TextInput accessibilityLabel={t('rss_url')} value={url} onChangeText={setUrl} maxLength={2048} editable={!source && !state.busy} autoCapitalize="none" autoCorrect={false} placeholder="https://example.com/feed.xml" selectionColor={C.rssAccent} style={styles.input} /></View>
    <View><SourceText style={T.metadata}>{t('rss_name')}</SourceText><TextInput accessibilityLabel={t('rss_name')} value={name} onChangeText={setName} maxLength={120} editable={!state.busy} selectionColor={C.rssAccent} style={styles.input} /><SourceText style={{fontSize: 12, color: C.rssIconMuted, marginTop: 4}}>{t('rss_name_hint')}</SourceText></View>
    {state.error ? <SourceText style={{fontSize: 13, color: C.danger}}>{t(`rss_error_${state.error}`)}</SourceText> : null}
    <SourceButton tone="rss" label={t(source ? 'rss_save_name' : 'rss_add')} busy={state.busy} disabled={state.busy || !url.trim()} onPress={() => {void (source ? controller.edit(source.id, name) : controller.add(url, name)).then(ok => {if (ok) onDismiss();});}} style={{minHeight: 48}} textStyle={{fontSize: 15}} />
  </SourceSheet>;
}
const styles = StyleSheet.create({switcher: {paddingLeft: 20, paddingRight: 20, paddingTop: 12, paddingBottom: 16, gap: 12}, source: {width: 72, alignItems: 'center'}, sourceCircle: {width: 48, height: 48, borderRadius: 24, borderWidth: 0.5, padding: 3, alignItems: 'center', justifyContent: 'center'}, image: {backgroundColor: '#F3EAE0', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'}, toolbar: {minHeight: 48, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingLeft: 24, paddingRight: 12}, empty: {alignItems: 'center', gap: 16, paddingHorizontal: 32, paddingVertical: 48}, article: {paddingHorizontal: 24, paddingVertical: 14}, articleMain: {flexDirection: 'row', gap: 12}, meta: {fontSize: 11, color: C.mutedText}, save: {flexDirection: 'row', alignItems: 'center'}, input: {...T.body, color: C.text, borderRadius: 12, borderWidth: 1, borderColor: C.switchOff, paddingHorizontal: 16, paddingVertical: 14, marginTop: 6}});
