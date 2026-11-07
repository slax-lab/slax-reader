import type { InterestCluster } from './recommendationAlgorithms'

export type PreferenceKind = 'article' | 'collection'
export type VectorIndexKind = 'article' | 'collection' | 'user'

export interface ArticleVectorIdentity {
  userId: number
  id: number
}

export const articleVectorId = ({ userId, id }: ArticleVectorIdentity): string => `a:${userId}:${id}`

export type VectorTarget = ({ kind: 'article' } & ArticleVectorIdentity) | { kind: 'collection'; id: number } | { kind: 'user'; id: number; preference: PreferenceKind }

export interface VectorRefreshResult {
  target: VectorTarget
  state: 'written' | 'deleted' | 'empty' | 'failed'
  vectorIds: string[]
  mutationIds: string[]
  writeToken?: string
  unchanged?: boolean
  removedVectorIds?: string[]
  reason?: string
  coverage?: { eligible: number; used: number; missing: number }
  stateVersion?: number
  superseded?: boolean
}

export interface VectorCandidate {
  id: number
  score: number
}

export interface ArticleVectorCandidate extends VectorCandidate {
  userId: number
}

export interface VectorQueryOptions {
  limit?: number
}

export type ArticleQueryOptions = VectorQueryOptions & ({ userId: number; recommendable?: never } | { recommendable: true; userId?: never })

export interface VectorMaintenance {
  refreshArticles(articles: ArticleVectorIdentity[]): Promise<VectorRefreshResult[]>
  refreshCollection(id: number): Promise<VectorRefreshResult>
  refreshUser(id: number, preference: PreferenceKind): Promise<VectorRefreshResult>
  readUser(id: number, preference: PreferenceKind): Promise<number[] | null>
  readArticleProfile(userId: number): Promise<{ vector: number[]; centered: number[]; interests: InterestCluster[] } | null>
  readArticles(articles: ArticleVectorIdentity[]): Promise<Map<string, number[]>>
  readCollections(ids: number[]): Promise<Map<number, number[]>>
  queryArticles(vector: number[], options: ArticleQueryOptions): Promise<ArticleVectorCandidate[]>
  queryCollections(vector: number[], options?: VectorQueryOptions): Promise<VectorCandidate[]>
  verifyRefresh(result: VectorRefreshResult): Promise<boolean>
}
