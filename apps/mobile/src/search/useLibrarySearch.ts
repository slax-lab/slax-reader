import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import type {CollectionRecord, TagRecord} from '../data/repositories';
import type {RssSubscription} from '@slax-reader/contracts';
import {useReadingMobile} from '../runtime';
import {useAccountScope} from '../settings/account-scope';
import {useRssLab} from '../settings/useRssLab';
import {SearchController} from './controller';
import {resolveTypedTags} from './query';
import type {SearchLocalPort, SearchSource} from './types';
const noLocal: SearchLocalPort = {watch: (_query, _limit, next) => {next({items: [], hasMore: false}); return () => {};}, admitRemote: async () => new Map()};
export function useLibrarySearch() {
  const mobile = useReadingMobile(), {api, repositories, runtime, nativeResourceOwner, preferences} = mobile;
  const scope = useAccountScope({...mobile, apiOrigin: api.options.baseUrl, fixture: Boolean(mobile.fixtureOnly)});
  const lab = useRssLab(api, scope, preferences), enabled = useRef(lab.enabled); enabled.current = lab.enabled;
  const controller = useMemo(() => new SearchController(repositories?.search ?? noLocal, api, () => scope.isCurrent(), () => enabled.current), [repositories, api, scope]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [text, storeText] = useState(''), [selected, storeSelected] = useState<string[]>([]), [invalid, setInvalid] = useState(false);
  const [tags, setTags] = useState<TagRecord[]>([]), [collections, setCollections] = useState<CollectionRecord[]>([]), [feeds, setFeeds] = useState<RssSubscription[]>([]);
  useEffect(() => {controller.activate(); return () => controller.dispose();}, [controller]);
  useEffect(() => {currentInput.current = {text: '', selected: [], source: undefined}; storeText(''); storeSelected([]); setTags([]); setCollections([]); setFeeds([]);}, [nativeResourceOwner]);
  useEffect(() => {
    if (!repositories || !scope.isCurrent()) return;
    const stops = [repositories.watchTags(setTags), repositories.watchCollections(setCollections), repositories.rss.watchSubscriptions(setFeeds)];
    return () => stops.forEach(stop => stop());
  }, [repositories, scope]);
  useEffect(() => {controller.availabilityChanged();}, [controller, lab.enabled]);
  const currentInput = useRef<{text: string; selected: string[]; source?: SearchSource}>({text, selected}); currentInput.current = {text, selected, source: currentInput.current.source};
  const edit = useCallback((nextText: string, nextSelected: string[], commit = false, nextSource: SearchSource | null = currentInput.current.source ?? null) => {
    let resolved = resolveTypedTags(nextText, nextSelected, tags);
    if (!resolved.unresolved && (commit || /\s$/.test(nextText))) {
      nextText = resolved.query.text; nextSelected = resolved.query.tagUuids;
    }
    const source = nextSelected.length ? undefined : nextSource ?? undefined;
    storeText(nextText); storeSelected(nextSelected); currentInput.current = {text: nextText, selected: nextSelected, source};
    const invalidSelected = nextSelected.some(id => !tags.some(tag => tag.id === id));
    setInvalid(invalidSelected || (commit && resolved.unresolved));
    controller.setQuery(invalidSelected || resolved.unresolved ? {text: '', tagUuids: [], ...(source ? {source} : {})} : {...resolved.query, ...(source ? {source} : {})}, commit);
    return !invalidSelected && !resolved.unresolved;
  }, [controller, tags]);
  useEffect(() => {const value = currentInput.current; edit(value.text, value.selected);}, [edit]);
  const setText = useCallback((value: string) => edit(value, currentInput.current.selected), [edit]);
  const setSelected = useCallback((value: string[]) => edit(currentInput.current.text, value, false, value.length ? null : currentInput.current.source ?? null), [edit]);
  const selectSource = useCallback((source?: SearchSource) => {edit(currentInput.current.text, source ? [] : currentInput.current.selected, true, source ?? null);}, [edit]);
  const submit = useCallback(() => {
    if (controller.getSnapshot().busy) return;
    const value = currentInput.current;
    if (edit(value.text, value.selected, true, value.source ?? null)) void controller.submit();
  }, [controller, edit]);
  return {...mobile, controller, state, text, setText, selected, setSelected, selectSource, tags, collections, feeds: lab.enabled ? feeds : [], invalid, submit};
}
