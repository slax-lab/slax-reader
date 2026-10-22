import { computed } from 'vue'

import type { FeedKind } from '@slax-reader/contracts'
import { useLocalRssPresence } from '~/composables/rss/useLocalRss'
import { rssLocalDatabase, rssLocalOwned } from '~/composables/rss/useRssLocalState'
import type { useLabFeatures } from '~/composables/useLabFeatures'

/**
 * RSS laboratory gate. A loaded laboratory response decides; until then (or when the request fails, e.g. offline),
 * synced RSS subscription rows of the current account provisionally enable RSS so local data stays reachable.
 */
export function useRssEnabled(labs: ReturnType<typeof useLabFeatures>, kind: FeedKind = 'rss') {
  const present = rssLocalDatabase() ? useLocalRssPresence(rssLocalOwned(), kind) : null
  return computed(() => (labs.loaded.value ? labs.isEnabled(kind) : !!present?.value))
}
