import {DISCOVERY_MEDIA_TYPE, type CollectionRecommendations} from '@slax-reader/contracts/collections';
import type {SlaxApi} from './api';

export function getDiscoveryCollections(api: Pick<SlaxApi, 'request'>, signal: AbortSignal) {
  return api.request<CollectionRecommendations>('/v1/recommendations/collections', 'GET', undefined, {limit: '36'}, signal, {
    access: 'required', accept: DISCOVERY_MEDIA_TYPE,
  });
}
