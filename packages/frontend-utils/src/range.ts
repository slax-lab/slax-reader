import search from 'approx-string-match'
import { getRangeTextWithNewlines } from './string'

export interface HighlightRangeInfo {
  // postion selector
  position_start: number
  position_end: number

  // fuzzy match
  exact: string
  prefix: string
  suffix: string
  raw_text?: string
}

export class HighlightRange {
  static FUZZY_MATCH_MAX_ERRORS = 0
  private container: HTMLElement
  private textContent: string

  constructor(
    private doc: Document,
    container?: HTMLElement
  ) {
    this.container = container || (this.doc as Document).body
    this.textContent = this.container.textContent || ''
  }

  private getTextOffset(node: Node, offset: number) {
    const walker = this.doc.createTreeWalker(this.container, NodeFilter.SHOW_TEXT, null)

    let totalOffset = 0
    let currentNode

    while ((currentNode = walker.nextNode()) && currentNode !== node) {
      totalOffset += currentNode.textContent!.length
    }

    if (currentNode === node) {
      totalOffset += offset
    }

    return totalOffset
  }

  private getNodeAndOffsetAtPosition(position: number) {
    const walker = this.doc.createTreeWalker(this.container, NodeFilter.SHOW_TEXT, null)

    let currentNode
    let currentOffset = 0

    while ((currentNode = walker.nextNode())) {
      const nodeLength = currentNode.textContent!.length

      if (currentOffset + nodeLength > position) {
        return {
          node: currentNode,
          offset: position - currentOffset
        }
      }

      currentOffset += nodeLength
    }

    return null
  }

  private createReangFromMatch(start: number, end: number) {
    const startInfo = this.getNodeAndOffsetAtPosition(start)
    const endInfo = this.getNodeAndOffsetAtPosition(end)

    if (!startInfo || !endInfo) return null

    const range = this.doc.createRange()
    range.setStart(startInfo.node, startInfo.offset)
    range.setEnd(endInfo.node, endInfo.offset)

    return range
  }

  private calculateSimilarity(str1: string, str2: string) {
    const match = this.calculateSimilarityMatch(str1, str2)
    if (!match) return 0

    return 1 - match.errors / str1.length
  }

  private calculateSimilarityMatch(str1: string, str2: string) {
    const maxErrors = Math.floor(Math.max(str1.length, str2.length) * 0.3)
    const variable1 = str1.length < str2.length ? str2 : str1
    const variable2 = str1.length < str2.length ? str1 : str2

    const matches = search(variable1, variable2, maxErrors)
    if (matches.length === 0) return null

    const bestMatch = matches.reduce((best, current) => (current.errors < best.errors ? current : best), matches[0]!)
    return bestMatch
  }

  private calculateContextScore(text: string, start: number, end: number, expectedContext: string) {
    start = Math.max(0, start)
    end = Math.min(text.length, end)

    if (start >= end) return 0

    const actualContext = text.substring(start, end)

    if (actualContext.length < expectedContext.length * 0.5) {
      return 0.3
    }

    return this.calculateSimilarity(actualContext, expectedContext)
  }

  // fuzzy match with context prefix and suffix
  private getRangeByFuzzy(item: HighlightRangeInfo) {
    const bodyContent = this.container.textContent
    if (!bodyContent) return null

    const matches = search(bodyContent, item.exact, HighlightRange.FUZZY_MATCH_MAX_ERRORS)
    if (matches.length < 1) return null

    const rankedMatches = matches.map(match => {
      const prefixScore = this.calculateContextScore(this.textContent, match.start - item.prefix.length, match.start, item.prefix)
      const suffixScore = this.calculateContextScore(this.textContent, match.end, match.end + item.suffix.length, item.suffix)

      let positionScore = 0
      if (item.position_start && item.position_end) {
        const distance = Math.abs((match.start + match.end) / 2 - (item.position_start + item.position_end) / 2)
        const maxDistance = this.textContent.length / 2
        positionScore = 1 - Math.min(1, distance / maxDistance)
      }

      // prefix and suffix weights 0.4, position weights 0.2
      const totalScore = prefixScore * 0.4 + suffixScore * 0.4 + positionScore * 0.2

      return {
        start: match.start,
        end: match.end,
        prefixScore,
        suffixScore,
        positionScore,
        totalScore
      }
    })

    const bestMatch = rankedMatches.reduce((best, current) => (current.totalScore > best.totalScore ? current : best), rankedMatches[0]!)

    // discard matches with too low a score
    if (bestMatch.totalScore > 0.3) return this.createReangFromMatch(bestMatch.start, bestMatch.end)
    return null
  }

  // just match by quote
  private getRangeByQuote(item: HighlightRangeInfo) {
    // only allow 2 errors(not match) in match textContent
    const matches = search(this.textContent, item.exact, 2)
    if (matches.length < 1) return null

    matches.sort((a, b) => {
      const aErrorRate = a.errors / (a.end - a.start)
      const bErrorRate = b.errors / (b.end - b.start)

      if (aErrorRate !== bErrorRate) return aErrorRate - bErrorRate

      // if error rate is same, choose the one with length closer to exact
      const aLengthDiff = Math.abs(a.end - a.start - item.exact.length)
      const bLengthDiff = Math.abs(b.end - b.start - item.exact.length)

      return aLengthDiff - bLengthDiff
    })

    return this.createReangFromMatch(matches[0]!.start, matches[0]!.end)
  }

  public getSelector(range: Range): HighlightRangeInfo {
    const exact = range.toString()

    const startOffset = this.getTextOffset(range.startContainer, range.startOffset)
    const endOffset = this.getTextOffset(range.endContainer, range.endOffset)

    const prefixStart = Math.max(0, startOffset - 32)
    const suffixEnd = Math.min(this.textContent.length, endOffset + 32)

    const prefix = this.textContent.substring(prefixStart, startOffset)
    const suffix = this.textContent.substring(endOffset, suffixEnd)

    return {
      exact,
      prefix,
      suffix,
      position_start: startOffset,
      position_end: endOffset,
      raw_text: getRangeTextWithNewlines(range)
    }
  }

  public getRange(item: HighlightRangeInfo) {
    for (const func of [this.getRangeByFuzzy, this.getRangeByQuote]) {
      const range = func.bind(this)(item)
      if (range) return range
    }

    return null
  }
}
