import { isPdfContentKey } from '@slax-reader/contracts/pdf'
import { inject, injectable } from '@/decorators/di'
import type { VectorIndexKind } from '@/utils/vectorMaintenanceTypes'
import { VectorMaintenanceRepo, type VectorArticleRow as ArticleRow, type VectorCollectionRow } from '@/infra/repository/dbVectorMaintenance'
import { VectorIndexClient } from '@/infra/repository/vectorIndexClient'
import { VectorPreferenceClient } from '@/infra/repository/vectorPreferenceClient'
import { VectorSourceRepo, type SourceFingerprint } from '@/infra/repository/vectorSources'
import { VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'
import type { ImageSelection } from '@/utils/vectorSources'
import {
  center,
  EMBEDDING_MEAN_VERSION,
  interestClusters,
  PINNERSAGE_MAX_ACTIONS,
  PINNERSAGE_WINDOW_DAYS,
  type InterestAction,
  type InterestCluster
} from '@/utils/recommendationAlgorithms'
import {
  addEntry,
  clonePreferenceSums,
  emptyPreferenceSums,
  nextPreferenceSeq,
  publicationScope,
  settlePreferenceSums,
  vectorToken,
  type MemberGroup,
  type PreferenceCall,
  type PreferencePublish,
  type PreferenceEntry,
  type PreferenceStore,
  type PreferenceSums
} from '@/utils/preferenceLedger'
import {
  addVector,
  ArticleVectorAccumulator,
  normalized,
  requestBytes,
  VECTOR_BATCH_SIZE,
  VECTOR_DIMENSIONS,
  VECTOR_MODEL,
  VECTOR_REQUEST_BYTES,
  type EmbeddedPart,
  type ModelInput
} from '@/utils/vectorEmbedding'
import {
  articleVectorId,
  type ArticleQueryOptions,
  type ArticleVectorIdentity,
  type PreferenceKind,
  type VectorMaintenance,
  type VectorQueryOptions,
  type VectorRefreshResult,
  type VectorTarget
} from '@/utils/vectorMaintenanceTypes'

type ArticleWork = {
  row: ArticleRow
  result: VectorRefreshResult
  fingerprint: SourceFingerprint
  oldParts: number
  count: number
  sum: ArticleVectorAccumulator
  images: ImageSelection
  first?: number[]
  input: AsyncGenerator<ModelInput>
  done: boolean
}

const VECTOR_GET_BATCH_SIZE = 20
const VECTOR_READ_BATCH_SIZE = 100
const VECTOR_METADATA_MAX_BYTES = 10 * 1024
const VECTOR_DELETE_VISIBILITY_ATTEMPTS = 3
const VECTOR_DELETE_VISIBILITY_DELAY_MS = 100

function positiveId(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid_vector_identity')
  return value
}

function result(target: VectorTarget): VectorRefreshResult {
  return { target, state: 'empty', vectorIds: [], mutationIds: [], removedVectorIds: [] }
}

function failed(output: VectorRefreshResult, error: unknown): VectorRefreshResult {
  output.state = 'failed'
  output.reason = error instanceof Error && /^[a-z][a-z0-9_]*(?::[a-z0-9:]+)?$/.test(error.message) ? error.message : 'vector_operation_failed'
  const detail = error && typeof error === 'object' ? (error as { message?: unknown; name?: unknown; code?: unknown }) : {}
  const rawMessage = typeof detail.message === 'string' ? detail.message : typeof error === 'string' ? error : 'unknown_runtime_error'
  const message = /password|authorization|bearer|secret/i.test(rawMessage)
    ? 'redacted_runtime_failure'
    : rawMessage
        .split(' ')
        .map(word => (word.includes('://') ? '[url]' : word))
        .join(' ')
        .slice(0, 240)
  const frames =
    error instanceof Error
      ? error.stack
          ?.split(String.fromCharCode(10))
          .slice(1, 4)
          .map(frame =>
            frame
              .split(' ')
              .map(word => (word.includes('://') ? '[location]' : word))
              .join(' ')
          )
      : undefined
  console.error('[vector-maintenance]', JSON.stringify({ kind: output.target.kind, name: detail.name, code: detail.code, message, frames }))
  return output
}

function oldPartCount(vector?: VectorizeVector): number {
  if (!vector) return 0
  const count = vector.metadata?.part_count
  if (!Number.isSafeInteger(count) || Number(count) < 1) throw new Error('invalid_stored_part_count')
  return Number(count)
}

function metadata(row: ArticleRow): Record<string, string | number | boolean> {
  return {
    user_id: row.user_id,
    bookmark_id: row.id,
    source_updated_at: new Date(row.updated_at).getTime(),
    published_at: new Date(row.published_at).getTime(),
    private_user: row.private_user
  }
}

async function contentWriteToken(identity: Record<string, string | number | boolean>, values?: ArrayLike<number>): Promise<string> {
  const ordered = Object.keys(identity)
    .sort()
    .map(key => [key, identity[key]])
  const header = new TextEncoder().encode(JSON.stringify([VECTOR_MODEL, 'text-matching', ordered]))
  const unit = values ? normalized(values) : []
  const payload = new Uint8Array(header.length + unit.length * Float32Array.BYTES_PER_ELEMENT)
  payload.set(header)
  const view = new DataView(payload.buffer)
  for (let i = 0; i < unit.length; i++) view.setFloat32(header.length + i * Float32Array.BYTES_PER_ELEMENT, unit[i], true)
  const digest = await crypto.subtle.digest('SHA-256', payload)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function matchesMetadata(vector: VectorizeVector, expected: Record<string, string | number | boolean>, token: string): boolean {
  return (
    vector.metadata?.recommendable === undefined && vector.metadata?.write_token === token && Object.entries(expected).every(([key, value]) => vector.metadata?.[key] === value)
  )
}

@injectable()
export class VectorMaintenanceService implements VectorMaintenance {
  constructor(
    @inject(VectorMaintenanceRepo) private readonly repo: VectorMaintenanceRepo,
    @inject(VectorSourceRepo) private readonly sources: VectorSourceRepo,
    @inject(VectorEmbeddingClient) private readonly embedding: VectorEmbeddingClient,
    @inject(VectorIndexClient) private readonly index: VectorIndexClient,
    @inject(VectorPreferenceClient) private readonly preferences: VectorPreferenceClient
  ) {}

  private async get(kind: VectorIndexKind, ids: string[]) {
    const found = new Map<string, VectorizeVector>()
    let offset = 0
    await Promise.all(
      Array.from({ length: Math.min(4, Math.ceil(ids.length / VECTOR_GET_BATCH_SIZE)) }, async () => {
        while (offset < ids.length) {
          const page = ids.slice(offset, offset + VECTOR_GET_BATCH_SIZE)
          offset += VECTOR_GET_BATCH_SIZE
          const allowed = new Set(page)
          for (const vector of await this.index.get(kind, page)) {
            if (!allowed.has(vector.id)) throw new Error('unexpected_vector_identity')
            found.set(vector.id, vector)
          }
        }
      })
    )
    return found
  }

  private async upsert(kind: VectorIndexKind, vectors: VectorizeVector[], outputs: VectorRefreshResult[]) {
    for (let offset = 0; offset < vectors.length; offset += VECTOR_READ_BATCH_SIZE) {
      const page = vectors.slice(offset, offset + VECTOR_READ_BATCH_SIZE).map((vector, index) => {
        const output = outputs[offset + index]
        if (!output.writeToken || !/^[a-f0-9]{64}$/.test(output.writeToken)) throw new Error('missing_content_write_token')
        const metadata = { ...(vector.metadata || {}), write_token: output.writeToken }
        if (new TextEncoder().encode(JSON.stringify(metadata)).length > VECTOR_METADATA_MAX_BYTES) throw new Error('vector_metadata_too_large')
        return { ...vector, metadata }
      })
      const mutation = await this.index.upsert(kind, page)
      for (const output of new Set(outputs.slice(offset, offset + VECTOR_READ_BATCH_SIZE))) output.mutationIds.push(mutation.mutationId)
    }
  }

  private async remove(kind: VectorIndexKind, ids: string[], output: VectorRefreshResult) {
    for (let offset = 0; offset < ids.length; offset += VECTOR_READ_BATCH_SIZE) {
      const page = ids.slice(offset, offset + VECTOR_READ_BATCH_SIZE)
      const mutation = await this.index.delete(kind, page)
      output.mutationIds.push(mutation.mutationId)
      output.removedVectorIds ||= []
      output.removedVectorIds.push(...page)
    }
  }

  private async removeParts(id: string, start: number, end: number, output: VectorRefreshResult) {
    for (let offset = start; offset < end; offset += VECTOR_READ_BATCH_SIZE) {
      const ids = Array.from({ length: Math.min(VECTOR_READ_BATCH_SIZE, end - offset) }, (_, i) => `${id}:c:${offset + i}`)
      await this.remove('article', ids, output)
      for (let attempt = 0; attempt < VECTOR_DELETE_VISIBILITY_ATTEMPTS; attempt++) {
        if (!(await this.get('article', ids)).size) break
        if (attempt + 1 === VECTOR_DELETE_VISIBILITY_ATTEMPTS) throw new Error('vector_delete_not_visible')
        await new Promise(resolve => setTimeout(resolve, VECTOR_DELETE_VISIBILITY_DELAY_MS))
      }
    }
  }

  private async removeArticle(identity: ArticleVectorIdentity, previous: VectorizeVector | undefined, output: VectorRefreshResult) {
    const id = articleVectorId(identity)
    const count = oldPartCount(previous)
    if (count > 1) await this.removeParts(id, 0, count, output)
    await this.remove('article', [id], output)
    output.vectorIds = [...(output.removedVectorIds || [])]
    output.state = previous ? 'deleted' : 'empty'
  }

  private async reuseArticle(row: ArticleRow, fingerprint: SourceFingerprint, previous: VectorizeVector | undefined, output: VectorRefreshResult): Promise<boolean> {
    const prior = previous?.metadata
    if (!previous || !prior || prior.source_updated_at !== new Date(row.updated_at).getTime() || Object.entries(fingerprint).some(([key, value]) => prior[key] !== value))
      return false
    const id = articleVectorId({ userId: row.user_id, id: row.id })
    if (previous.id !== id || prior.user_id !== row.user_id || prior.bookmark_id !== row.id || prior.kind !== 'article') throw new Error('invalid_stored_article_identity')
    const count = oldPartCount(previous)
    const ids = [id]
    if (count > 1) {
      for (let offset = 0; offset < count; offset += VECTOR_READ_BATCH_SIZE) {
        const page = Array.from({ length: Math.min(VECTOR_READ_BATCH_SIZE, count - offset) }, (_, i) => `${id}:c:${offset + i}`)
        const stored = await this.get('article', page)
        const chunks: VectorizeVector[] = []
        for (let index = 0; index < page.length; index++) {
          const key = page[index]
          const vector = stored.get(key)
          if (!vector) return false
          if (
            vector.metadata?.user_id !== row.user_id ||
            vector.metadata?.bookmark_id !== row.id ||
            vector.metadata?.kind !== 'chunk' ||
            vector.metadata?.part_index !== offset + index
          )
            throw new Error('invalid_stored_chunk_identity')
          const expected = { ...metadata(row), kind: 'chunk', part_index: offset + index }
          if (!matchesMetadata(vector, expected, output.writeToken!)) chunks.push({ id: key, values: vector.values, metadata: expected })
        }
        await this.upsert(
          'article',
          chunks,
          chunks.map(() => output)
        )
        ids.push(...page)
      }
    }
    const expected = { ...metadata(row), ...fingerprint, kind: 'article', part_count: count }
    if (!matchesMetadata(previous, expected, output.writeToken!)) await this.upsert('article', [{ id, values: previous.values, metadata: expected }], [output])
    output.vectorIds = ids
    output.state = 'written'
    return true
  }

  async refreshArticles(articles: ArticleVectorIdentity[]): Promise<VectorRefreshResult[]> {
    return this.writeArticles(articles)
  }

  async refreshArticlesWithPrevious(articles: ArticleVectorIdentity[]): Promise<{ results: VectorRefreshResult[]; previous: Record<string, number[]> }> {
    const previous = new Map<string, number[]>()
    const results = await this.writeArticles(articles, previous)
    return { results, previous: Object.fromEntries(previous) }
  }

  private async writeArticles(articles: ArticleVectorIdentity[], previous?: Map<string, number[]>): Promise<VectorRefreshResult[]> {
    const unique = [
      ...new Map(
        articles.map(identity => {
          positiveId(identity.userId)
          positiveId(identity.id)
          return [articleVectorId(identity), identity] as const
        })
      ).values()
    ]
    const outputs: VectorRefreshResult[] = []
    for (let offset = 0; offset < unique.length; offset += 10) {
      const page = unique.slice(offset, offset + 10)
      const current = page.map(identity => result({ kind: 'article', ...identity }))
      outputs.push(...current)
      try {
        const rows = await this.repo.findArticles(page)
        const byId = new Map(rows.map(row => [articleVectorId({ userId: row.user_id, id: row.id }), row]))
        const old = await this.get('article', page.map(articleVectorId))
        const work: ArticleWork[] = []
        for (let i = 0; i < page.length; i++) {
          const id = articleVectorId(page[i])
          const row = byId.get(id)
          try {
            const stored = old.get(id)
            if (!row) {
              if (stored) previous?.set(id, Array.from(stored.values))
              await this.removeArticle(page[i], stored, current[i])
            } else if (row.status !== 'success') failed(current[i], new Error('source_not_ready'))
            else {
              const fingerprint = await this.sources.fingerprint(row)
              current[i].writeToken = await contentWriteToken({ target: id, title: row.title, ...fingerprint, ...metadata(row) })
              if (await this.reuseArticle(row, fingerprint, stored, current[i])) continue
              if (stored) previous?.set(id, Array.from(stored.values))
              const images: ImageSelection = { selected: 0, skipped: {} }
              work.push({
                row,
                result: current[i],
                fingerprint,
                oldParts: oldPartCount(old.get(id)),
                count: 0,
                sum: new ArticleVectorAccumulator(),
                images,
                input: this.sources.articleInputs(row, images),
                done: false
              })
            }
          } catch (error) {
            failed(current[i], error)
          }
        }
        await this.embedArticles(work)
      } catch (error) {
        for (const output of current) if (output.state !== 'written' && output.state !== 'deleted') failed(output, error)
      }
    }
    return outputs
  }

  private async embedArticles(work: ArticleWork[]) {
    let chunks: VectorizeVector[] = []
    let owners: VectorRefreshResult[] = []
    const flush = async () => {
      if (!chunks.length) return
      const vectors = chunks
      const outputs = owners
      chunks = []
      owners = []
      try {
        await this.upsert('article', vectors, outputs)
      } catch (error) {
        for (const output of outputs) failed(output, error)
      }
    }
    const append = async (item: ArticleWork, part: EmbeddedPart) => {
      const id = articleVectorId({ userId: item.row.user_id, id: item.row.id })
      item.sum.add(part)
      const chunk = (index: number, values: number[]) => {
        chunks.push({ id: `${id}:c:${index}`, values, metadata: { ...metadata(item.row), kind: 'chunk', part_index: index } })
        owners.push(item.result)
      }
      if (!item.count) item.first = part.values
      else {
        if (item.count === 1) chunk(0, item.first!)
        chunk(item.count, part.values)
      }
      item.count++
      if (chunks.length >= 100) await flush()
    }
    for (const item of work.filter(item => isPdfContentKey(item.row.content_key))) {
      try {
        const input = await this.sources.pdfInput(item.row)
        if (!input) continue
        for (const values of await this.embedding.pdf(input.base64)) {
          await append(item, { values, weight: 1, modality: 'pdf' })
          if (item.result.state === 'failed') break
        }
      } catch (error) {
        failed(item.result, error)
      }
      item.done = true
    }
    let inputs: ModelInput[] = []
    let inputOwners: ArticleWork[] = []
    const embed = async () => {
      if (!inputs.length) return
      const batch = inputs
      const selected = inputOwners
      inputs = []
      inputOwners = []
      try {
        const vectors = await this.embedding.embed(batch)
        for (let i = 0; i < vectors.length; i++) for (const part of vectors[i]) await append(selected[i], part)
      } catch (error) {
        for (const item of selected) failed(item.result, error)
      }
    }
    while (work.some(item => !item.done && item.result.state !== 'failed')) {
      for (const item of work) {
        if (item.done || item.result.state === 'failed') continue
        try {
          let next: IteratorResult<ModelInput> = await item.input.next()
          if (next.done) {
            item.done = true
            continue
          }
          if (!('text' in next.value)) {
            await embed()
            while (!next.done) {
              for (const part of (await this.embedding.embed([next.value]))[0]) await append(item, part)
              next = { done: true, value: undefined }
              next = await item.input.next()
            }
            item.done = true
          } else {
            if (inputs.length && (inputs.length >= VECTOR_BATCH_SIZE || requestBytes([...inputs, next.value]) > VECTOR_REQUEST_BYTES)) await embed()
            inputs.push(next.value)
            inputOwners.push(item)
          }
        } catch (error) {
          failed(item.result, error)
        }
      }
      await embed()
    }
    await flush()
    const representatives: VectorizeVector[] = []
    const represented: ArticleWork[] = []
    for (const item of work) {
      const id = articleVectorId({ userId: item.row.user_id, id: item.row.id })
      try {
        await item.input.return(undefined)
        if (item.result.state === 'failed') {
          if (item.count > Math.max(1, item.oldParts)) await this.removeParts(id, item.oldParts > 1 ? item.oldParts : 0, item.count, item.result)
          continue
        }
        if (!item.count) {
          if (item.oldParts > 1) await this.removeParts(id, 0, item.oldParts, item.result)
          await this.remove('article', [id], item.result)
          item.result.vectorIds = [...(item.result.removedVectorIds || [])]
          item.result.state = item.oldParts ? 'deleted' : 'empty'
          continue
        }
        if (item.oldParts > 1 && item.oldParts > item.count) await this.removeParts(id, item.count === 1 ? 0 : item.count, item.oldParts, item.result)
        representatives.push({ id, values: item.sum.values(), metadata: { ...metadata(item.row), ...item.fingerprint, kind: 'article', part_count: item.count } })
        represented.push(item)
      } catch (error) {
        failed(item.result, error)
      }
    }
    try {
      await this.upsert(
        'article',
        representatives,
        represented.map(item => item.result)
      )
      for (const item of represented) {
        const id = articleVectorId({ userId: item.row.user_id, id: item.row.id })
        item.result.vectorIds = [id]
        if (item.count > 1) for (let i = 0; i < item.count; i++) item.result.vectorIds.push(`${id}:c:${i}`)
        try {
          item.result.state = 'written'
          if (item.images.selected || Object.keys(item.images.skipped).length) {
            item.result.reason = `images_selected:${item.images.selected};images_skipped:${Object.entries(item.images.skipped)
              .map(([reason, count]) => `${reason}:${count}`)
              .join(',')}`
          }
        } catch (error) {
          failed(item.result, error)
        }
      }
    } catch (error) {
      for (const item of represented) {
        failed(item.result, error)
        if (item.count > Math.max(1, item.oldParts)) {
          const id = articleVectorId({ userId: item.row.user_id, id: item.row.id })
          await this.removeParts(id, item.oldParts > 1 ? item.oldParts : 0, item.count, item.result).catch(cleanupError =>
            console.error('[vector-maintenance] failed representative chunk cleanup', { id }, cleanupError)
          )
        }
      }
    }
  }

  async readArticles(articles: ArticleVectorIdentity[]): Promise<Map<string, number[]>> {
    const ids = [
      ...new Set(
        articles.map(identity => {
          positiveId(identity.userId)
          positiveId(identity.id)
          return articleVectorId(identity)
        })
      )
    ]
    const vectors = await this.get('article', ids)
    const output = new Map<string, number[]>()
    for (const [id, vector] of vectors) output.set(id, normalized(vector.values))
    return output
  }

  async readCollections(ids: number[]): Promise<Map<number, number[]>> {
    const unique = [...new Set(ids.map(positiveId))]
    const vectors = await this.get(
      'collection',
      unique.map(id => `c:${id}`)
    )
    const output = new Map<number, number[]>()
    for (const id of unique) {
      const vector = vectors.get(`c:${id}`)
      if (vector) output.set(id, normalized(vector.values))
    }
    return output
  }

  async readUser(id: number, preference: PreferenceKind): Promise<number[] | null> {
    positiveId(id)
    if (preference !== 'article' && preference !== 'collection') throw new Error('invalid_preference_kind')
    if (preference === 'collection') return (await this.readCollectionPreference(id)).vector
    const key = `u:${id}:${preference}`
    const vector = (await this.get('user', [key])).get(key)
    if (!vector) return null
    if (vector.namespace !== `user-${preference}`) throw new Error('invalid_preference_namespace')
    return normalized(vector.values)
  }

  async readCollectionPreference(userId: number) {
    positiveId(userId)
    const coverage = { eligible: 0, used: 0, missing: 0 }
    const vector = await this.aggregateCollections(userId, coverage)
    return { vector, coverage }
  }

  async readArticleProfile(userId: number): Promise<{ vector: number[]; centered: number[]; interests: InterestCluster[] } | null> {
    positiveId(userId)
    const key = `u:${userId}:article`
    const vectors = await this.get('user', [key, `${key}:centered`])
    const stored = vectors.get(key)
    const centered = vectors.get(`${key}:centered`)
    if (!stored || !centered) return null
    if (stored.namespace !== 'user-article' || centered.namespace !== 'user-article') throw new Error('invalid_preference_namespace')
    const interests: InterestCluster[] = []
    const metadata = stored.metadata?.interests
    if (metadata !== undefined) {
      if (typeof metadata !== 'string') throw new Error('invalid_preference_interests')
      let parsed: unknown
      try {
        parsed = JSON.parse(metadata)
      } catch {
        throw new Error('invalid_preference_interests')
      }
      if (!Array.isArray(parsed)) throw new Error('invalid_preference_interests')
      for (const pair of parsed) {
        if (!Array.isArray(pair) || pair.length !== 2 || !Number.isSafeInteger(pair[0]) || pair[0] <= 0 || typeof pair[1] !== 'number' || !Number.isFinite(pair[1]) || pair[1] <= 0)
          throw new Error('invalid_preference_interests')
        interests.push({ medoidBookmarkId: pair[0], importance: pair[1] })
      }
    }
    return { vector: normalized(stored.values), centered: normalized(centered.values), interests }
  }

  async maintainPreference(store: PreferenceStore, calls: PreferenceCall[]): Promise<VectorRefreshResult[]> {
    const userId = positiveId(calls[0]?.userId ?? 0)
    if (calls.some(call => call.userId !== userId)) throw new Error('invalid_preference_batch')
    const stored = store.read()
    let sums: PreferenceSums | null = null
    if (stored?.meanVersion === EMBEDDING_MEAN_VERSION && calls.every(call => call.kind !== 'rebuild'))
      sums = await this.applyPreference(
        store,
        stored,
        userId,
        calls.filter(call => call.kind === 'apply')
      )
    if (!sums) sums = await this.rebuildPreference(store, userId, stored?.seq ?? 0)
    return this.publishPreference(store, userId, sums, publicationScope(calls))
  }

  private async applyPreference(
    store: PreferenceStore,
    stored: PreferenceSums,
    userId: number,
    calls: Extract<PreferenceCall, { kind: 'apply' }>[]
  ): Promise<PreferenceSums | null> {
    const previous = new Map<number, number[][]>()
    for (const call of calls) {
      positiveId(call.id)
      const list = previous.get(call.id) ?? []
      if (call.previous?.length === VECTOR_DIMENSIONS) list.push(call.previous)
      previous.set(call.id, list)
    }
    const ids = [...previous.keys()]
    const sums = clonePreferenceSums(stored)
    const upserts = new Map<number, PreferenceEntry>()
    const deletes: number[] = []
    if (ids.length) {
      const applied = store.entries(ids)
      const rows = new Map((await this.repo.findUserPreferenceRows(userId, ids)).map(row => [row.id, row]))
      const vectors = await this.get(
        'article',
        ids.map(id => articleVectorId({ userId, id }))
      )
      for (const id of ids) {
        const old = applied.get(id)
        const current = vectors.get(articleVectorId({ userId, id }))?.values
        const token = current ? vectorToken(current) : ''
        if (old) {
          const values = !old.token ? undefined : old.token === token ? current : previous.get(id)!.find(candidate => vectorToken(candidate) === old.token)
          if (old.token && !values) return null
          addEntry(sums, old, values, -1)
        }
        const row = rows.get(id)
        if (!row || !current) sums.interests = sums.interests.filter(([medoid]) => medoid !== id)
        if (!row) {
          if (old) deletes.push(id)
          continue
        }
        const desired: PreferenceEntry = { weight: row.is_starred ? 2 : 1, group: row.share_group, token }
        addEntry(sums, desired, current, 1)
        if (old?.weight !== desired.weight || old?.group !== desired.group || old?.token !== desired.token) upserts.set(id, desired)
      }
    }
    settlePreferenceSums(sums)
    sums.seq = nextPreferenceSeq(stored.seq)
    store.commit(sums, upserts, deletes)
    return sums
  }

  private async rebuildPreference(store: PreferenceStore, userId: number, previousSeq: number): Promise<PreferenceSums> {
    const now = Date.now()
    const recent = await this.repo.listRecentUserActions(userId, new Date(now - PINNERSAGE_WINDOW_DAYS * 86_400_000), PINNERSAGE_MAX_ACTIONS)
    const recentIds = new Set(recent.map(action => action.id))
    const sums = emptyPreferenceSums(EMBEDDING_MEAN_VERSION, nextPreferenceSeq(previousSeq))
    const entries = new Map<number, PreferenceEntry>()
    const representatives = new Map<number, number[]>()
    let after = 0
    for (;;) {
      const rows = await this.repo.listUserArticles(userId, after, VECTOR_READ_BATCH_SIZE)
      if (!rows.length) break
      const ids = rows.map(row => articleVectorId({ userId, id: row.id }))
      const values = await this.get('article', ids)
      for (let i = 0; i < rows.length; i++) {
        const vector = values.get(ids[i])
        const entry: PreferenceEntry = { weight: rows[i].is_starred ? 2 : 1, group: rows[i].share_group, token: vector ? vectorToken(vector.values) : '' }
        entries.set(rows[i].id, entry)
        addEntry(sums, entry, vector?.values, 1)
        if (vector && recentIds.has(rows[i].id)) representatives.set(rows[i].id, normalized(vector.values))
      }
      const last = rows[rows.length - 1].id
      if (last <= after) throw new Error('invalid_dependency_page')
      after = last
      if (rows.length < VECTOR_READ_BATCH_SIZE) break
    }
    settlePreferenceSums(sums)
    const actions: InterestAction[] = recent.flatMap(action => {
      const vector = representatives.get(action.id)
      return vector ? [{ bookmarkId: action.id, vector, actedAt: new Date(action.acted_at).getTime() }] : []
    })
    sums.interests = interestClusters(actions, now, center).map(cluster => [cluster.medoidBookmarkId, cluster.importance])
    store.replace(sums, entries)
    return sums
  }

  private async publishPreference(store: PreferenceStore, userId: number, sums: PreferenceSums, scope: PreferencePublish): Promise<VectorRefreshResult[]> {
    const outputs = [...(scope.user ? [await this.publishUserPreference(userId, sums)] : []), ...(await this.publishOwnerCollections(store, userId, sums, scope.collections))]
    if (!sums.counts.eligible) await store.clear()
    return outputs
  }

  private async publishUserPreference(userId: number, sums: PreferenceSums): Promise<VectorRefreshResult> {
    const output = result({ kind: 'user', id: userId, preference: 'article' })
    const key = `u:${userId}:article`
    const keys = [key, `${key}:centered`]
    const { eligible, used } = sums.counts
    output.coverage = { eligible, used, missing: eligible - used }
    output.stateVersion = sums.seq
    try {
      if (!eligible) {
        await this.remove('user', keys, output)
        output.vectorIds = keys
        output.state = 'deleted'
        return output
      }
      if (!used) throw new Error('no_usable_preference_vectors')
      const namespace = 'user-article'
      const vector = normalized(sums.raw)
      const centered = normalized(sums.centered)
      const metadata: Record<string, string> = { interests: JSON.stringify(sums.interests), embedding_mean_version: EMBEDDING_MEAN_VERSION }
      const identity = { target: key, namespace, centered: await contentWriteToken({ target: keys[1], namespace, embedding_mean_version: EMBEDDING_MEAN_VERSION }, centered) }
      output.writeToken = await contentWriteToken({ ...identity, ...metadata }, vector)
      await this.upsert(
        'user',
        [
          { id: key, namespace, values: vector, metadata: { ...metadata, state_version: sums.seq } },
          { id: keys[1], namespace, values: centered, metadata: { embedding_mean_version: EMBEDDING_MEAN_VERSION, state_version: sums.seq } }
        ],
        [output, output]
      )
      output.vectorIds = keys
      output.state = 'written'
      return output
    } catch (error) {
      return failed(output, error)
    }
  }

  private async publishOwnerCollections(store: PreferenceStore, userId: number, sums: PreferenceSums, scope: PreferencePublish['collections']): Promise<VectorRefreshResult[]> {
    const outputs: VectorRefreshResult[] = []
    if (Array.isArray(scope) && !scope.length) return outputs
    for (const { id } of await this.repo.listOwnerCollections(userId)) {
      if (Array.isArray(scope) && !scope.includes(id)) continue
      const output = result({ kind: 'collection', id })
      outputs.push(output)
      output.stateVersion = sums.seq
      try {
        const collection = await this.repo.findCollection(id)
        const groups: MemberGroup[] = collection?.sharing ? ['shared', 'inherited'] : ['shared']
        if (collection?.owner_id === userId && groups.some(group => sums.counts[group].members)) await this.writeCollection(store, collection, sums, groups, output)
        else {
          output.vectorIds = [`c:${id}`]
          await this.remove('collection', [`c:${id}`], output)
          output.state = 'deleted'
        }
      } catch (error) {
        failed(output, error)
      }
    }
    return outputs
  }

  private async writeCollection(store: PreferenceStore, collection: VectorCollectionRow, sums: PreferenceSums, groups: MemberGroup[], output: VectorRefreshResult) {
    const key = `c:${collection.id}`
    if (groups.some(group => sums.counts[group].missing)) {
      const missing = store.firstMissing(groups)
      if (missing === undefined) throw new Error('invalid_preference_state')
      throw new Error(`missing_dependency:${articleVectorId({ userId: collection.owner_id, id: missing })}`)
    }
    output.vectorIds = [key]
    const owner = new Float64Array(VECTOR_DIMENSIONS)
    for (const group of groups) for (let i = 0; i < VECTOR_DIMENSIONS; i++) owner[i] += sums[group][i]
    const vector = normalized(owner)
    const publication = { collection_id: collection.id, owner_id: collection.owner_id, recommendable: true, published_at: collection.published_at }
    output.writeToken = await contentWriteToken({ target: key, ...publication }, vector)
    const previous = (await this.get('collection', [key])).get(key)
    if (previous?.metadata?.write_token === output.writeToken) output.unchanged = true
    else await this.upsert('collection', [{ id: key, values: vector, metadata: { ...publication, state_version: sums.seq } }], [output])
    output.state = 'written'
  }

  private async aggregateCollections(userId: number, coverage: NonNullable<VectorRefreshResult['coverage']>): Promise<number[] | null> {
    const sum = new Float64Array(VECTOR_DIMENSIONS)
    let after = 0
    for (;;) {
      const rows = await this.repo.listUserCollections(userId, after, VECTOR_READ_BATCH_SIZE)
      if (!rows.length) break
      coverage.eligible += rows.length
      const ids = rows.map(row => `c:${row.id}`)
      const values = await this.get('collection', ids)
      for (const vectorId of ids) {
        const vector = values.get(vectorId)
        if (!vector) {
          coverage.missing++
          continue
        }
        addVector(sum, vector.values, 1)
        coverage.used++
      }
      const last = rows[rows.length - 1].id
      if (last <= after) throw new Error('invalid_dependency_page')
      after = last
      if (rows.length < VECTOR_READ_BATCH_SIZE) break
    }
    return coverage.used ? normalized(sum) : null
  }

  async refreshCollection(id: number): Promise<VectorRefreshResult> {
    return this.updateCollection(id, (owner, publish) => this.preferences.rebuild(owner, publish))
  }

  async applyCollection(id: number): Promise<VectorRefreshResult> {
    return this.updateCollection(id, (owner, publish) => this.preferences.publish(owner, publish))
  }

  private async updateCollection(id: number, run: (owner: number, publish: PreferencePublish) => Promise<VectorRefreshResult[]>): Promise<VectorRefreshResult> {
    positiveId(id)
    const output = result({ kind: 'collection', id })
    try {
      const collection = await this.repo.findCollection(id)
      if (!collection) {
        output.vectorIds = [`c:${id}`]
        await this.remove('collection', [`c:${id}`], output)
        output.state = 'deleted'
        return output
      }
      const published = (await run(collection.owner_id, { user: false, collections: [id] })).find(item => item.target.kind === 'collection' && item.target.id === id)
      if (!published) throw new Error('vector_refresh_missing_result')
      return published
    } catch (error) {
      return failed(output, error)
    }
  }

  async refreshUser(id: number, preference: PreferenceKind): Promise<VectorRefreshResult> {
    positiveId(id)
    if (preference !== 'article' && preference !== 'collection') throw new Error('invalid_preference_kind')
    const output = result({ kind: 'user', id, preference })
    if (preference === 'article') output.coverage = { eligible: 0, used: 0, missing: 0 }
    try {
      if (preference === 'article') {
        const published = (await this.preferences.rebuild(id, { user: true, collections: [] })).find(item => item.target.kind === 'user')
        if (!published) throw new Error('vector_refresh_missing_result')
        return published
      }
      const key = `u:${id}:collection`
      output.reason = 'collection_preference_on_demand'
      if (!(await this.get('user', [key])).has(key)) return output
      await this.remove('user', [key], output)
      output.vectorIds = [key]
      output.state = 'deleted'
      return output
    } catch (error) {
      return failed(output, error)
    }
  }

  async applyArticle(identity: ArticleVectorIdentity, previous?: number[]): Promise<VectorRefreshResult[]> {
    positiveId(identity.userId)
    positiveId(identity.id)
    return this.preferences.apply(identity.userId, identity.id, previous)
  }

  async queryArticles(vector: number[], options: ArticleQueryOptions) {
    const matches = await this.index.query('article', normalized(vector), options)
    return matches.map(match => {
      const parts = /^a:([1-9]\d*):([1-9]\d*)$/.exec(match.id)
      if (!parts || !Number.isFinite(match.score)) throw new Error('invalid_article_candidate')
      return { userId: positiveId(Number(parts[1])), id: positiveId(Number(parts[2])), score: match.score }
    })
  }

  async queryCollections(vector: number[], options: VectorQueryOptions = {}) {
    const matches = await this.index.query('collection', normalized(vector), options)
    return matches.map(match => {
      const parts = /^c:([1-9]\d*)$/.exec(match.id)
      if (!parts || !Number.isFinite(match.score)) throw new Error('invalid_collection_candidate')
      return { id: positiveId(Number(parts[1])), score: match.score }
    })
  }

  async verifyRefresh(output: VectorRefreshResult): Promise<boolean> {
    try {
      if (output.state === 'failed') return false
      if (output.state === 'empty' && !output.removedVectorIds?.length) return true
      const kind = output.target.kind
      if (output.state === 'written') {
        if (!output.writeToken || !output.vectorIds.length) return false
        for (let offset = 0; offset < output.vectorIds.length; offset += VECTOR_GET_BATCH_SIZE) {
          const page = output.vectorIds.slice(offset, offset + VECTOR_GET_BATCH_SIZE)
          const vectors = new Map((await this.index.get(kind, page)).map(vector => [vector.id, vector]))
          const current = (id: string) => {
            const metadata = vectors.get(id)?.metadata
            if (!metadata) return false
            if (metadata.write_token === output.writeToken) return true
            return output.stateVersion !== undefined && Number(metadata.state_version) > output.stateVersion
          }
          if (!page.every(current)) return false
        }
      }
      const removed = output.state === 'deleted' ? [...new Set([...output.vectorIds, ...(output.removedVectorIds || [])])] : output.removedVectorIds || []
      for (let offset = 0; offset < removed.length; offset += VECTOR_GET_BATCH_SIZE) {
        if ((await this.index.get(kind, removed.slice(offset, offset + VECTOR_GET_BATCH_SIZE))).length) return false
      }
      return output.state === 'written' || output.state === 'deleted' || output.state === 'empty'
    } catch {
      return false
    }
  }
}
