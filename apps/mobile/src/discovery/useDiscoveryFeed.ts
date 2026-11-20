import {useEffect, useState} from 'react';
import type {CollectionRecommendations} from '@slax-reader/contracts/collections';
import type {SlaxApi} from '../data/api';
import {getDiscoveryCollections} from '../data/discovery';

type FeedState = {status: 'loading' | 'error'} | {status: 'ready'; result: CollectionRecommendations};

export function useDiscoveryFeed(api: Pick<SlaxApi, 'request'>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FeedState>({status: 'loading'});

  useEffect(() => {
    const controller = new AbortController();
    setState({status: 'loading'});
    async function load() {
      try {
        const result = await getDiscoveryCollections(api, controller.signal);
        if (!Array.isArray(result?.items)) throw new Error('Invalid collection recommendations');
        if (!controller.signal.aborted) setState({status: 'ready', result});
      } catch {
        if (!controller.signal.aborted) setState({status: 'error'});
      }
    }
    void load();
    return () => controller.abort();
  }, [api, attempt]);

  return {state, retry: () => setAttempt(current => current + 1)};
}
