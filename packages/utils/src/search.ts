/// <reference path="./types/dom-anchor-text-position.d.ts" />
import search from 'approx-string-match'
import { toRange } from 'dom-anchor-text-position'

/**
 * 文本规范化并保留位置映射
 * 将连续空格压缩为单个空格，同时记录每个字符在原始文本中的位置
 */
function normalizeWithRanges(raw: string) {
  const ranges: { start: number; end: number }[] = []
  const text = raw.replace(/(\s+)|([^\s])/g, (match, space, _char, offset) => {
    ranges.push({ start: offset, end: offset + match.length })
    return space ? ' ' : match
  })

  return { text, ranges }
}

// 跳过脚本/样式，防止误配水合数据
const NON_VISIBLE_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TITLE'])

// 块级标签换行处补一个空格
const LINE_BREAK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'UL',
  'OL',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'NAV',
  'ASIDE',
  'MAIN',
  'PRE',
  'HR',
  'DL',
  'DT',
  'DD',
  'FIGURE',
  'FIGCAPTION',
  'DETAILS',
  'SUMMARY',
  'FORM',
  'ADDRESS'
])

// trueLength 为内容真实长度，越界回退用它兜底
type SearchableText = { content: string; rawOffsets: number[]; trueLength: number }

// 构造带换行分隔符的可搜索文本，按元素缓存避免重复遍历
function getSearchableText(root: Element, cache: WeakMap<Element, SearchableText>): SearchableText {
  const cached = cache.get(root)
  if (cached) {
    return cached
  }

  let content = ''
  const rawOffsets: number[] = []
  let trueOffset = 0

  function appendSeparator() {
    if (content.length > 0 && !/\s$/.test(content)) {
      content += ' '
      rawOffsets.push(trueOffset)
    }
  }

  function walk(node: ChildNode) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue || ''
      for (let i = 0; i < text.length; i++) {
        content += text[i]
        rawOffsets.push(trueOffset)
        trueOffset++
      }
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return
    }

    const element = node as Element
    if (NON_VISIBLE_TAGS.has(element.tagName)) {
      trueOffset += (element.textContent || '').length
      return
    }

    if (element.tagName === 'BR') {
      appendSeparator()
      return
    }

    // 递归查缓存，未命中才遍历
    const childResult = getSearchableText(element, cache)
    const base = trueOffset
    content += childResult.content
    childResult.rawOffsets.forEach(offset => rawOffsets.push(base + offset))
    trueOffset += childResult.trueLength

    if (LINE_BREAK_TAGS.has(element.tagName)) {
      appendSeparator()
    }
  }

  root.childNodes.forEach(walk)

  const result: SearchableText = { content, rawOffsets, trueLength: trueOffset }
  cache.set(root, result)
  return result
}

// 查找最合适的匹配元素
export function findBestMatch(text: string, dom?: Element, fuzzy: boolean = true): { element: HTMLElement; match: { start: number; end: number; errors: number } } | null {
  const normalizedText = text.trim().replace(/\s+/g, ' ')
  const maxErrors = fuzzy ? Math.max(3, Math.floor(normalizedText.length / 3)) : 0

  const result: {
    candidate: {
      element: HTMLElement
      errors: number
      length: number
      match: { start: number; end: number; errors: number }
    } | null
  } = { candidate: null }

  // 缓存子树文本，避免重复遍历
  const searchableTextCache = new WeakMap<Element, SearchableText>()

  function traverse(node: Node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement

      const isJSDOM = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')
      if (!isJSDOM && element.offsetHeight === 0 && element.offsetWidth === 0) {
        return
      }

      const { content, rawOffsets, trueLength } = getSearchableText(element, searchableTextCache)
      const { text, ranges } = normalizeWithRanges(content)
      // 换算回真实下标，越界用 trueLength 兜底
      const toRawOffset = (index: number) => (index < rawOffsets.length ? rawOffsets[index]! : trueLength)

      if (content && content.length >= normalizedText.length - maxErrors) {
        const matches = search(text, normalizedText, maxErrors)
        if (matches.length > 0) {
          matches.sort((a, b) => a.errors - b.errors)
          const bestMatchInElement = matches[0]!

          if (
            !result.candidate ||
            bestMatchInElement.errors < result.candidate.errors ||
            (bestMatchInElement.errors === result.candidate.errors && content.length <= result.candidate.length)
          ) {
            const rawStart = toRawOffset(ranges[bestMatchInElement.start]!.start)
            const rawEnd = toRawOffset(ranges[bestMatchInElement.end - 1]!.end)

            result.candidate = {
              element,
              errors: bestMatchInElement.errors,
              length: content.length,
              match: {
                start: rawStart,
                end: rawEnd,
                errors: bestMatchInElement.errors
              }
            }
          }
        } else if (fuzzy) {
          const regText = normalizedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
          const regex = new RegExp(regText, 'i')
          const exactMatch = content.match(regex)
          if (exactMatch && exactMatch.index !== undefined) {
            result.candidate = {
              element,
              errors: 0,
              length: content.length,
              match: {
                start: toRawOffset(exactMatch.index),
                end: toRawOffset(exactMatch.index + exactMatch[0].length),
                errors: 0
              }
            }
          }
        }
      }

      Array.from(element.children).forEach(child => traverse(child))
    }
  }

  traverse(dom || document.body)

  if (result.candidate) {
    return { element: result.candidate.element, match: result.candidate.match }
  }

  return null
}

// 查找单个匹配元素
export function findMatchingElement(anchorText: string, dom?: Element): { element: HTMLElement; range: Range | null } | null {
  const normalizedAnchor = anchorText.trim().replace(/\s+/g, ' ')

  try {
    const fuzzyResult = findBestMatch(normalizedAnchor, dom)
    if (fuzzyResult) {
      const { element, match } = fuzzyResult
      const range = toRange(element, { start: match.start, end: match.end })

      if (range) {
        let container = range.commonAncestorContainer
        if (container.nodeType === Node.TEXT_NODE && container.parentNode) {
          container = container.parentNode
        }
        return { element: (container as HTMLElement) || element, range }
      }
    }
  } catch (error) {
    console.warn('[Search Utils] 搜索近似文本时出错:', error)
  }

  console.warn(`[Search Utils] 未找到匹配元素: ${anchorText}`)
  return null
}

// 寻找符合文本的对应元素
export const findMatchingElements = (text: string, dom?: Element): Node[] => {
  const result = findBestMatch(text, dom)
  return result ? [result.element] : []
}

// 用于解析markdown文本，提取且关系节点的关系，返回一个二元组列表，每个二元组第一个代表其父节点，第二个则是子节点
export const extractMarkdownNodes = (modelResponse: string) => {
  // 匹配# ## -，分别是一二三级节点
  let root = ''
  let levelOneNode = ''

  const resList: [string, string][] = []
  const rootPatt = new RegExp('^#\\s*(.+)')
  const levelOnePatt = new RegExp('^##\\s*(.+)')
  const levelTwoPatt = new RegExp('^-\\s*(.+)')

  const lines = modelResponse.split('\n')
  lines.forEach(line => {
    if (!root) {
      const rMatch = rootPatt.exec(line)
      if (rMatch) {
        root = rMatch[1]!
        return
      }
    }
    const loMatch = levelOnePatt.exec(line)
    if (loMatch) {
      levelOneNode = loMatch[1]!
      const edge: [string, string] = [root, levelOneNode]
      // 使用 JSON.stringify 来比较两个数组（边）是否相等
      if (!resList.some(e => JSON.stringify(e) === JSON.stringify(edge))) {
        resList.push(edge)
        return
      }
    }
    const ltMatch = levelTwoPatt.exec(line)
    if (ltMatch) {
      const edge: [string, string] = [levelOneNode, ltMatch[1]!]
      if (!resList.some(e => JSON.stringify(e) === JSON.stringify(edge))) {
        resList.push(edge)
      }
    }
  })

  return resList
}

// 用于解析markdown文本，提取所有的锚点引用，返回一个字符串列表
export const queryMarkdownAnchorQuote = (markdown: string) => {
  const anchorPatt = new RegExp(/\[(.+?)\]\(#((?:\([^)]*\)|[^)])*)\)/g)
  const result: { index: number; anchorNum: string; text: string; anchorText: string }[] = []
  let matches: RegExpExecArray | null = null
  while ((matches = anchorPatt.exec(markdown)) !== null) {
    result.push({
      index: matches.index,
      anchorNum: encodeURIComponent(String(matches[1])),
      text: matches[2] ?? '',
      anchorText: matches[0]
    })
  }

  return result
}

// 用于解析markdown文本，提取所有的锚点引用（包括不完整的），返回一个字符串列表
export const querySimularMarkdownAnchorQuote = (markdown: string) => {
  const anchorPatt = new RegExp(/\[(.+)\]\(#(.*)/g)
  const result: { index: number; anchorNum: string; text: string; anchorText: string }[] = []
  let matches: RegExpExecArray | null = null
  while ((matches = anchorPatt.exec(markdown)) !== null) {
    result.push({
      index: matches.index,
      anchorNum: encodeURIComponent(String(matches[1])),
      text: matches[2] ?? '',
      anchorText: matches[0]
    })
  }

  return result
}

// 用于解析markdown文本，提取所有的锚点引用，返回一个字符串列表
export const queryEndlineSentenceBeginWithStartBlock = (markdown: string) => {
  const sentencesPatt = new RegExp(/\[(.*)$/g)
  const result: { index: number; text: string }[] = []
  let matches: RegExpExecArray | null = null
  while ((matches = sentencesPatt.exec(markdown)) !== null) {
    result.push({
      index: matches.index,
      text: matches[0]
    })
  }

  return result
}

// 用于解析markdown文本，提取所有的类似锚点的引用，返回一个字符串列表
export const queryAnchorAlikeQuote = (markdown: string) => {
  const sentencesPatt = new RegExp(/(\[\d\]\(anchor_.*\))/g)
  const result: { index: number; text: string }[] = []
  let matches: RegExpExecArray | null = null
  while ((matches = sentencesPatt.exec(markdown)) !== null) {
    result.push({
      index: matches.index,
      text: matches[0]
    })
  }

  return result
}
