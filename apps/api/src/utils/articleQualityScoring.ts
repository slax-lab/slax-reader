import { parseHTML } from 'linkedom'
import type { ParserName } from './parserUtils/type'

export const ARTICLE_QUALITY_SCORING_VERSION = 'slax-corpus-scoring-v3' as const

export interface ArticleQualityReview {
  version: typeof ARTICLE_QUALITY_SCORING_VERSION
  status: 'scored' | 'unavailable'
  score: number | null
  textRecall: number | null
  textF2: number | null
  imageRecall: number | null
  tableRecall: number | null
  codeRecall: number | null
  linkRecall: number | null
  headingRecall: number | null
  structure: number | null
  hardFailures: string[]
  comment: string
  selectedParser?: ParserName
  parserReviews?: ParserQualitySummary[]
}

export interface ParserQualitySummary {
  parser: ParserName
  review: ArticleQualityReview
  error?: string
}

export interface ArticleQualityScoringInput {
  sourceHtml: string
  candidateHtml: string
  url: string
}

type Block = { kind: string; text: string }

interface ExtractedContent {
  text: string
  images: string[]
  tables: string[]
  links: string[]
  code: string[]
  headings: string[]
  blocks: Block[]
}

interface ResourceScore {
  expected: number
  actual: number
  recall: number | null
  f2: number | null
}

interface MultisetScore {
  recall: number
  f2: number
}

const MAX_STRUCTURE_BLOCKS = 600
const COMPLETENESS_WEIGHTS = Object.freeze({
  text: 0.35,
  images: 0.25,
  tables: 0.12,
  code: 0.12,
  links: 0.08,
  headings: 0.04,
  structure: 0.04
})

const normalizeText = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const isCjk = (value: string) => /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(value)

const tokenize = (value: string): string[] => {
  const matches =
    normalizeText(value)
      .toLocaleLowerCase()
      .match(/[\p{L}\p{M}\p{N}_]+|[^\s\p{P}\p{S}]/gu) || []
  return matches.flatMap(token => (isCjk(token) && Array.from(token).length > 1 ? Array.from(token) : [token]))
}

const unique = (values: Array<string | null>) => Array.from(new Set(values.filter((value): value is string => Boolean(value))))

const normalizeUrl = (value: string | null | undefined, base: URL, unwrapProxy = false): string | null => {
  let raw = String(value || '').trim()
  if (!raw || /^(?:data:|javascript:|#)/i.test(raw)) return null

  if (unwrapProxy) {
    try {
      const proxyUrl = new URL(raw, base)
      const encodedUrl = proxyUrl.searchParams.get('u')
      if (encodedUrl) {
        let decodedUrl = encodedUrl
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const next = decodeURIComponent(decodedUrl)
            if (next === decodedUrl) break
            decodedUrl = next
          } catch {
            break
          }
        }
        if (/^https?:\/\//i.test(decodedUrl)) raw = decodedUrl
      }
    } catch {
      // Fall through and try to normalize the original value.
    }
  }

  try {
    const url = new URL(raw, base)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

const tableSignature = (table: Element) =>
  Array.from(table.querySelectorAll('tr'))
    .map(row =>
      Array.from(row.querySelectorAll('th,td'))
        .map(cell => normalizeText(cell.textContent))
        .join('\u001f')
    )
    .join('\u001e')

const isSemanticTable = (table: Element) => {
  const rows = Array.from(table.querySelectorAll('tr'))
  const maxColumns = rows.reduce((max, row) => {
    const directCells = Array.from(row.children).filter(child => child.tagName === 'TH' || child.tagName === 'TD').length
    return Math.max(max, directCells)
  }, 0)
  const text = normalizeText(table.textContent)
  return Boolean(text && (table.querySelector('th') || (rows.length >= 2 && maxColumns >= 2)))
}

const documentContentRoot = (document: Document): Element => {
  const body = document.body
  return body && (body.childElementCount > 0 || normalizeText(body.textContent).length > 0) ? body : document.documentElement || body
}

const rootForSource = (document: Document): Element => {
  const marked = Array.from(document.querySelectorAll('[data-slax-content-root="v1"]')).filter(
    node => normalizeText(node.textContent).length || Boolean(node.querySelector('img,video,table,pre,a,h1,h2,h3,h4,h5,h6'))
  )
  if (marked.length === 1) return marked[0]

  const candidates = Array.from(document.querySelectorAll('article,[itemprop="articleBody"],#js_content,main'))
  return (
    (candidates.length ? candidates : Array.from(document.querySelectorAll('[data-slax-content-root]'))).sort(
      (left, right) => normalizeText(right.textContent).length - normalizeText(left.textContent).length
    )[0] || documentContentRoot(document)
  )
}

const extract = (html: string, url: URL, source: boolean): ExtractedContent => {
  const document = parseHTML(html || '').document
  const root = source ? rootForSource(document) : documentContentRoot(document)
  const imageValues = Array.from(root.querySelectorAll('img,picture source,video[poster],video source')).map(node => {
    const value =
      node.getAttribute('data-original-src') ||
      node.getAttribute('data-src') ||
      node.getAttribute('data-original') ||
      node.getAttribute('data-lazy-src') ||
      node.getAttribute('src') ||
      node.getAttribute('poster') ||
      (node.getAttribute('srcset') || '').split(',')[0]?.trim().split(/\s+/)[0]
    return normalizeUrl(value, url, !source)
  })
  const links = Array.from(root.querySelectorAll('a[href]')).map(node => normalizeUrl(node.getAttribute('href'), url))
  const tables = Array.from(root.querySelectorAll('table')).filter(isSemanticTable).map(tableSignature).filter(Boolean)
  const code = Array.from(root.querySelectorAll('pre'))
    .map(node => normalizeText(node.textContent))
    .filter(Boolean)
  const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .map(node => normalizeText(node.textContent))
    .filter(Boolean)
  const blocks = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,figure'))
    .map(node => ({
      kind: /^H[1-6]$/.test(node.tagName)
        ? 'heading'
        : node.tagName === 'TABLE'
          ? 'table'
          : node.tagName === 'PRE'
            ? 'code'
            : node.tagName === 'FIGURE'
              ? 'figure'
              : node.tagName === 'LI'
                ? 'list-item'
                : 'paragraph',
      text: normalizeText(node.textContent || node.getAttribute('alt'))
    }))
    .filter(block => Boolean(block.text))

  return {
    text: normalizeText(root.textContent),
    images: unique(imageValues),
    links: unique(links),
    tables: unique(tables),
    code: unique(code),
    headings,
    blocks
  }
}

const multisetScore = (actual: string[], expected: string[]): MultisetScore => {
  if (!expected.length) return { recall: 1, f2: actual.length ? 0 : 1 }

  const counts = (values: string[]) => {
    const result = new Map<string, number>()
    for (const value of values) result.set(value, (result.get(value) || 0) + 1)
    return result
  }

  const actualCounts = counts(actual)
  const expectedCounts = counts(expected)
  let overlap = 0
  for (const [token, count] of actualCounts) overlap += Math.min(count, expectedCounts.get(token) || 0)

  const precision = actual.length ? overlap / actual.length : 0
  const recall = overlap / expected.length
  const f2 = precision + recall ? (5 * precision * recall) / (4 * precision + recall) : 0
  return { recall, f2 }
}

const resourceScore = (actual: string[], expected: string[], signature: (value: string) => string = value => value): ResourceScore => {
  const actualValues = unique(actual.map(signature))
  const expectedValues = unique(expected.map(signature))
  const overlap = expectedValues.filter(value => actualValues.includes(value)).length
  const recall = expectedValues.length ? overlap / expectedValues.length : null
  const precision = actualValues.length ? overlap / actualValues.length : expectedValues.length ? 0 : null
  const f2 = precision === null || recall === null ? null : precision + recall ? (5 * precision * recall) / (4 * precision + recall) : 0
  return { expected: expectedValues.length, actual: actualValues.length, recall, f2 }
}

const structureScore = (expected: Block[], actual: Block[]): number | null => {
  if (!expected.length) return null

  const clip = (values: Block[]) =>
    values.length <= MAX_STRUCTURE_BLOCKS ? values : [...values.slice(0, Math.floor(MAX_STRUCTURE_BLOCKS / 2)), ...values.slice(-Math.ceil(MAX_STRUCTURE_BLOCKS / 2))]
  const expectedBlocks = clip(expected)
  const actualBlocks = clip(actual)
  let previous = new Uint16Array(actualBlocks.length + 1)
  const same = (left: Block, right: Block) => left.kind === right.kind && (left.text === right.text || left.text.includes(right.text) || right.text.includes(left.text))

  for (let i = 1; i <= expectedBlocks.length; i++) {
    const current = new Uint16Array(actualBlocks.length + 1)
    for (let j = 1; j <= actualBlocks.length; j++) {
      current[j] = same(expectedBlocks[i - 1], actualBlocks[j - 1]) ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1])
    }
    previous = current
  }

  return previous[actualBlocks.length] / Math.max(expectedBlocks.length, actualBlocks.length)
}

const completenessScore = (components: Record<string, number | null>) => {
  let total = 0
  let usedWeight = 0
  for (const [name, weight] of Object.entries(COMPLETENESS_WEIGHTS)) {
    const value = components[name]
    if (!Number.isFinite(value)) continue
    total += weight * (value as number)
    usedWeight += weight
  }
  return usedWeight ? total / usedWeight : 0
}

const round = (value: number | null, digits = 4) => (value === null ? null : Number(value.toFixed(digits)))

const percent = (value: number | null) => (value === null ? '无原始资源' : `${(value * 100).toFixed(1)}%`)

const failureLabel = (failure: string) => {
  const labels: Record<string, string> = {
    candidate_empty: '正文为空',
    'text_recall_below_0.35': '正文召回率低于 35%',
    all_images_missing: '图片全部缺失',
    all_tables_missing: '表格全部缺失',
    all_code_missing: '代码全部缺失',
    all_content_links_missing: '正文链接全部缺失'
  }
  return labels[failure] || failure
}

const buildComment = (review: Omit<ArticleQualityReview, 'comment'>) => {
  if (review.status === 'unavailable') return '评分不可用（未能完成原文与解析结果比对）'

  const failures = review.hardFailures.length ? `；风险：${review.hardFailures.map(failureLabel).join('、')}` : ''
  return (
    `综合完整度 ${(review.score! * 100).toFixed(1)}%；` +
    `正文召回 ${percent(review.textRecall)}（F2 ${percent(review.textF2)}）；` +
    `图片 ${percent(review.imageRecall)}；表格 ${percent(review.tableRecall)}；` +
    `代码 ${percent(review.codeRecall)}；链接 ${percent(review.linkRecall)}；` +
    `结构 ${percent(review.structure)}${failures}`
  )
}

export const unavailableArticleQualityReview = (): ArticleQualityReview => {
  const review: Omit<ArticleQualityReview, 'comment'> = {
    version: ARTICLE_QUALITY_SCORING_VERSION,
    status: 'unavailable',
    score: null,
    textRecall: null,
    textF2: null,
    imageRecall: null,
    tableRecall: null,
    codeRecall: null,
    linkRecall: null,
    headingRecall: null,
    structure: null,
    hardFailures: []
  }
  return { ...review, comment: buildComment(review) }
}

export const scoreArticleQuality = ({ sourceHtml, candidateHtml, url }: ArticleQualityScoringInput): ArticleQualityReview => {
  const baseUrl = new URL(url)
  const source = extract(sourceHtml, baseUrl, true)
  const candidate = extract(candidateHtml, baseUrl, false)
  const sourceTokens = tokenize(source.text)
  const candidateTokens = tokenize(candidate.text)
  const text = multisetScore(candidateTokens, sourceTokens)
  const images = resourceScore(candidate.images, source.images)
  const tables = resourceScore(candidate.tables, source.tables)
  const code = resourceScore(candidate.code, source.code)
  const links = resourceScore(candidate.links, source.links)
  const headings = resourceScore(candidate.headings, source.headings, value => normalizeText(value).toLocaleLowerCase())
  const structure = structureScore(source.blocks, candidate.blocks)
  const hardFailures: string[] = []

  if (source.text.length > 0 && candidate.text.length === 0) hardFailures.push('candidate_empty')
  if (sourceTokens.length > 0 && text.recall < 0.35) hardFailures.push('text_recall_below_0.35')
  if (images.expected > 0 && images.actual === 0) hardFailures.push('all_images_missing')
  if (tables.expected > 0 && tables.actual === 0) hardFailures.push('all_tables_missing')
  if (code.expected > 0 && code.actual === 0) hardFailures.push('all_code_missing')
  if (links.expected >= 3 && links.actual === 0) hardFailures.push('all_content_links_missing')

  const review: Omit<ArticleQualityReview, 'comment'> = {
    version: ARTICLE_QUALITY_SCORING_VERSION,
    status: 'scored',
    score: round(completenessScore({ text: text.f2, images: images.f2, tables: tables.f2, code: code.f2, links: links.f2, headings: headings.f2, structure })),
    textRecall: round(text.recall),
    textF2: round(text.f2),
    imageRecall: round(images.recall),
    tableRecall: round(tables.recall),
    codeRecall: round(code.recall),
    linkRecall: round(links.recall),
    headingRecall: round(headings.recall),
    structure: round(structure),
    hardFailures: Array.from(new Set(hardFailures))
  }
  return { ...review, comment: buildComment(review) }
}

export const formatArticleQualityReview = (review?: ArticleQualityReview): string => review?.comment || '评分不可用（没有可比对的原始 HTML）'

export const formatArticleQualityComparison = (review?: ArticleQualityReview): string => {
  if (!review) return '评分不可用（没有可比对的原始 HTML）'
  if (!review.parserReviews?.length) return formatArticleQualityReview(review)

  const parserLabel: Record<ParserName, string> = { readability: 'Readability', defuddle: 'Defuddle' }
  const selected = review.selectedParser ? `；最终选择 ${parserLabel[review.selectedParser]}` : ''
  const details = review.parserReviews
    .map(item => {
      const suffix = item.error ? `；错误：${item.error}` : ''
      return `${parserLabel[item.parser]}：${formatArticleQualityReview(item.review)}${suffix}`
    })
    .join('\n')
  return `${formatArticleQualityReview(review)}${selected}\n${details}`
}
