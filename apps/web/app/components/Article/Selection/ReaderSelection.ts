import type { MarkManager } from '@slax-reader/selection'
import type { QuoteData } from '@slax-reader/selection/types'

/** Operations shared by HTML and PDF readers and the existing notes panel. */
export type ReaderSelection = Pick<MarkManager, 'markItemInfos' | 'strokeSelection' | 'deleteStroke' | 'deleteComment'> & {
  findQuote(quote: QuoteData): void
  revealMark?(id: string): void
}
