import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import type {CollectionRecord, TagRecord} from '../data/repositories';
import type {RssSubscription} from '@slax-reader/contracts';
import {useReadingMobile} from '../runtime';
import {useAccountScope} from '../settings/account-scope';
import {useRssLab} from '../settings/useRssLab';
import {SearchController} from './controller';
import {resolveTypedTags} from './query';
import type {SearchLocalPort} from './types';
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
  useEffect(() => {storeText(''); storeSelected([]); setTags([]); setCollections([]); setFeeds([]);}, [nativeResourceOwner]);
  useEffect(() => {
    if (!repositories || !scope.isCurrent()) return;
    const stops = [repositories.watchTags(setTags), repositories.watchCollections(setCollections), repositories.rss.watchSubscriptions(setFeeds)];
    return () => stops.forEach(stop => stop());
  }, [repositories, scope]);
  useEffect(() => {controller.availabilityChanged();}, [controller, lab.enabled]);
  const currentInput = useRef({text, selected}); currentInput.current = {text, selected};
  const edit = useCallback((nextText: string, nextSelected: string[], commit = false) => {
    let resolved = resolveTypedTags(nextText, nextSelected, tags);
    if (!resolved.unresolved && (commit || /\s$/.test(nextText))) {
      nextText = resolved.query.text; nextSelected = resolved.query.tagUuids;
    }
    storeText(nextText); storeSelected(nextSelected); currentInput.current = {text: nextText, selected: nextSelected};
    const invalidSelected = nextSelected.some(id => !tags.some(tag => tag.id === id));
    setInvalid(invalidSelected || (commit && resolved.unresolved));
    controller.setQuery(invalidSelected || resolved.unresolved ? {text: '', tagUuids: []} : resolved.query, commit);
    return !invalidSelected && !resolved.unresolved;
  }, [controller, tags]);
  useEffect(() => {const value = currentInput.current; edit(value.text, value.selected);}, [edit]);
  const setText = useCallback((value: string) => edit(value, currentInput.current.selected), [edit]);
  const setSelected = useCallback((value: string[]) => edit(currentInput.current.text, value), [edit]);
  const submit = useCallback(() => {
    if (controller.getSnapshot().busy) return;
    const value = currentInput.current;
    if (edit(value.text, value.selected, true)) void controller.submit();
  }, [controller, edit]);
  return {...mobile, controller, state, text, setText, selected, setSelected, tags, collections, feeds: lab.enabled ? feeds : [], invalid, submit};
}
