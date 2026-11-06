import type {
  HybridSearchChannel,
  HybridSearchChannelOutcome,
  HybridSearchChannelSuccess,
  HybridSearchEntity,
  HybridSearchEvent,
  HybridSearchEvidence,
  HybridSearchHit,
  HybridSearchRequest
} from '@slax-reader/contracts'
import { inject, injectable } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { HybridSearchService, HybridSearchError, compareSearchIdentity, searchOriginKey, type SearchChannelResult, type SearchMatch } from '../hybridSearch'

export const SEARCH_CHANNELS: readonly HybridSearchChannel[] = ['titles', 'fulltext', 'article_vector', 'collection_vector']
export const SEARCH_RRF_K = 60

function mergeEntity(previous: HybridSearchEntity, current: HybridSearchEntity): HybridSearchEntity {
  if (previous.type !== 'article' || current.type !== 'article') return previous
  const origins = [...new Map([...previous.origins, ...current.origins].map(origin => [searchOriginKey(origin), origin])).values()].sort((a, b) =>
    compareSearchIdentity(searchOriginKey(a), searchOriginKey(b))
  )
  return { ...previous, origins, ...(current.excerpt ? { excerpt: current.excerpt } : {}) }
}

function distinct(matches: SearchMatch[]): SearchMatch[] {
  const output = new Map<string, SearchMatch>()
  for (const match of matches) {
    const previous = output.get(match.entity.id)
    output.set(match.entity.id, previous ? { ...previous, entity: mergeEntity(previous.entity, match.entity) } : match)
  }
  return [...output.values()]
}

export function fuseSearchResults(channels: Partial<Record<HybridSearchChannel, SearchMatch[]>>): HybridSearchHit[] {
  const fused = new Map<string, HybridSearchHit>()
  for (const channel of SEARCH_CHANNELS) {
    for (const [index, match] of distinct(channels[channel] ?? []).entries()) {
      const rank = index + 1
      let evidence: HybridSearchEvidence
      if (channel === 'titles') evidence = { channel, rank }
      else {
        if (match.nativeScore === undefined || !Number.isFinite(match.nativeScore)) throw new HybridSearchError('retrieval_failed')
        evidence =
          channel === 'fulltext' ? { channel, rank, native_score: match.nativeScore, normalized_score: -match.nativeScore } : { channel, rank, native_score: match.nativeScore }
      }
      const previous = fused.get(match.entity.id)
      fused.set(match.entity.id, {
        ...(previous ? mergeEntity(previous, match.entity) : match.entity),
        matched_channels: [...(previous?.matched_channels ?? []), channel],
        evidence: [...(previous?.evidence ?? []), evidence],
        rrf_score: (previous?.rrf_score ?? 0) + 1 / (SEARCH_RRF_K + rank)
      })
    }
  }
  return [...fused.values()].sort((left, right) => right.rrf_score - left.rrf_score || compareSearchIdentity(left.id, right.id))
}

function outcome(result: SearchChannelResult): HybridSearchChannelSuccess {
  return { status: result.matches.length ? 'ok' : 'empty', count: result.matches.length, coverage: result.coverage }
}

@injectable()
export class HybridSearchOrchestrator {
  constructor(@inject(HybridSearchService) private search: HybridSearchService) {}

  async stream(ctx: ContextManager, request: HybridSearchRequest, signal: AbortSignal, emit: (event: HybridSearchEvent) => void): Promise<void> {
    const userId = ctx.getUserId()
    const results: Partial<Record<HybridSearchChannel, SearchChannelResult>> = {}
    const channels: Partial<Record<HybridSearchChannel, HybridSearchChannelOutcome>> = {}
    const failed = (channel: HybridSearchChannel, error: unknown) => {
      delete results[channel]
      const failure = { status: 'error' as const, code: error instanceof HybridSearchError ? error.code : ('retrieval_failed' as const) }
      channels[channel] = failure
      if (!signal.aborted) emit({ type: 'channel_error', channel, outcome: failure })
    }
    const run = async (channel: HybridSearchChannel, work: () => Promise<SearchChannelResult>) => {
      try {
        const result = await work()
        signal.throwIfAborted()
        result.matches = distinct(result.matches)
        const partial = fuseSearchResults({ [channel]: result.matches })
        results[channel] = result
        channels[channel] = outcome(result)
        emit({ type: 'partial', channel, results: partial, outcome: outcome(result) })
      } catch (error) {
        if (!signal.aborted) failed(channel, error)
      }
    }

    const titles = run('titles', () => this.search.titles(userId, request.keyword, signal))
    const fulltext = run('fulltext', () => this.search.fulltext(ctx, request.keyword, signal))
    const embedding = this.search.queryEmbedding(request.keyword, signal)
    const articles = run('article_vector', async () => this.search.articleVector(userId, await embedding, signal))
    const collections = run('collection_vector', async () => this.search.collectionVector(userId, await embedding, signal))
    await Promise.allSettled([titles, fulltext, articles, collections])
    if (signal.aborted) return

    try {
      const current = await this.search.revalidateAll(userId, results, signal, request.keyword)
      for (const item of current) {
        if (item.error) failed(item.channel, item.error)
        else {
          results[item.channel] = item.result
          channels[item.channel] = outcome(item.result)
        }
      }
    } catch {
      if (!signal.aborted)
        for (const channel of SEARCH_CHANNELS) {
          if (results[channel]) failed(channel, new HybridSearchError('admission_failed'))
        }
    }
    if (signal.aborted) return
    const fused = fuseSearchResults(Object.fromEntries(SEARCH_CHANNELS.map(channel => [channel, results[channel]?.matches ?? []])))
    emit({
      type: 'complete',
      results: fused,
      channels: channels as Record<HybridSearchChannel, HybridSearchChannelOutcome>,
      incomplete: SEARCH_CHANNELS.some(channel => {
        const current = channels[channel]
        return !current || current.status === 'error' || current.coverage.reasons.length > 0 || !current.coverage.exhausted
      }),
      replaces_partials: true
    })
  }
}
