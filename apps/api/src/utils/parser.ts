import { parseHTML } from 'linkedom'
import moment from 'moment-timezone'
import {
  bylineParserHandle,
  defuddleParse,
  fallbackParserHandle,
  postParserHandle,
  PreparserHandle,
  publishedTimeParserHandle,
  readabilityParse,
  slaxReadability,
  titleParserHandle
} from './parserUtils'
import { ParserName, Preparse } from './parserUtils/type'
import { ReadabilityParseError } from '../const/err'

interface RawParseResult {
  title?: string | null
  content?: string | null
  textContent?: string | null
  length?: number | null
  excerpt?: string | null
  byline?: string | null
  dir?: string | null
  siteName?: string | null
  lang?: string | null
  publishedTime?: string | null
}

const setDocumentUri = (document: Document, url: string) => {
  Object.defineProperty(document, 'documentURI', { value: url, writable: false, configurable: true })
}

export class ContentParser {
  public static async parse(options: { url: URL; content: string; title?: string }): Promise<Preparse> {
    const content = this.getCleanHtml(options.content)

    console.log(`Start parsing content for URL: ${options.url.toString()}, content length: ${content.length}`)

    let rawDocument = this.getDocument(content)
    // 设置 documentURI，让 Readability 能识别微信域名
    setDocumentUri(rawDocument, options.url.toString())
    let rawTitle = rawDocument.title

    // 预处理hook
    await PreparserHandle(options.url, rawDocument)

    // Readability内容解析
    let res = slaxReadability(options.url, rawDocument)
    if (!res) {
      res = await fallbackParserHandle(options.url, rawDocument)
    }
    if (!res) throw ReadabilityParseError()

    // Readability内容转换为DOM
    const document = this.getDocument(res.content || '')

    // 文章标题提取
    res.title = titleParserHandle(options.url, rawDocument, options.title, rawTitle)

    // 作者提取
    res.byline = bylineParserHandle(options.url, res.byline || '', document, rawDocument)

    // 发布时间提取
    res.publishedTime = publishedTimeParserHandle(options.url, res.publishedTime || '', document)

    // 后处理
    await postParserHandle(options.url, document)

    // 发布时间转换
    let publishedTime = new Date()
    if (res.publishedTime && res.publishedTime.trim()) {
      res.publishedTime = res.publishedTime.replace(/年|月/g, '-').replace('日', '')
      try {
        const parsedTime = moment(res.publishedTime)
        if (parsedTime.isValid()) publishedTime = parsedTime.toDate()
      } catch {}
    }

    return {
      ...res,
      publishedTime,
      contentDocument: document,
      title: res.title || '',
      content: res.content || '',
      textContent: res.textContent || '',
      length: res.length || 0,
      excerpt: res.excerpt || '',
      byline: res.byline || '',
      dir: res.dir || '',
      siteName: res.siteName || '',
      lang: res.lang || ''
    }
  }

  public static async parseCandidates(options: { url: URL; content: string; title?: string }): Promise<ParseCandidate[]> {
    const content = this.getCleanHtml(options.content)
    const preparedDocument = this.getDocument(content)
    setDocumentUri(preparedDocument, options.url.toString())
    const rawTitle = preparedDocument.title

    await PreparserHandle(options.url, preparedDocument)
    const preparedHtml = preparedDocument.documentElement.outerHTML
    const specs: Array<{ parser: ParserName; parse: (document: Document) => RawParseResult | null | Promise<RawParseResult | null> }> = [
      { parser: 'readability', parse: document => readabilityParse(document) },
      { parser: 'defuddle', parse: document => defuddleParse(options.url.toString(), document) }
    ]

    return Promise.all(
      specs.map(async ({ parser, parse }) => {
        try {
          const rawDocument = this.getDocument(preparedHtml)
          setDocumentUri(rawDocument, options.url.toString())
          const result = await parse(rawDocument)
          if (!result) throw new Error(`${parser} returned empty result`)
          const parseRes = await this.finalizeParse(options, rawDocument, rawTitle, result)
          return { parser, parseRes }
        } catch (error) {
          return { parser, error: error instanceof Error ? error.message : String(error) }
        }
      })
    )
  }

  private static async finalizeParse(options: { url: URL; content: string; title?: string }, rawDocument: Document, rawTitle: string, result: RawParseResult): Promise<Preparse> {
    const document = this.getDocument(result.content || '')
    result.title = titleParserHandle(options.url, rawDocument, options.title, rawTitle)
    result.byline = bylineParserHandle(options.url, result.byline || '', document, rawDocument)
    result.publishedTime = publishedTimeParserHandle(options.url, result.publishedTime || '', document)
    await postParserHandle(options.url, document)

    let publishedTime = new Date()
    if (result.publishedTime && String(result.publishedTime).trim()) {
      result.publishedTime = String(result.publishedTime).replace(/年|月/g, '-').replace('日', '')
      try {
        const parsedTime = moment(result.publishedTime)
        if (parsedTime.isValid()) publishedTime = parsedTime.toDate()
      } catch {}
    }

    return {
      ...result,
      publishedTime,
      contentDocument: document,
      title: result.title || '',
      content: result.content || '',
      textContent: result.textContent || '',
      length: result.length || 0,
      excerpt: result.excerpt || '',
      byline: result.byline || '',
      dir: result.dir || '',
      siteName: result.siteName || '',
      lang: result.lang || ''
    }
  }

  public static getDocument(src: string): Document {
    const { document } = parseHTML(src)
    return document
  }

  public static getCleanHtml(rawHtml: string): string {
    function removeScriptAndStyleTags(html: string): string {
      const scriptAndStyleTagsRegex = /<(script|style)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi
      return html.replace(scriptAndStyleTagsRegex, '')
    }

    function removeInlineEventHandlers(html: string): string {
      const eventHandlerRegex = /\s(on\w+)=["'].*?["']/gi
      return html.replace(eventHandlerRegex, '')
    }

    function removeUnnecessaryAttributes(html: string): string {
      const unnecessaryAttributesRegex = /\s(type|language)=["'].*?["']/gi
      return html.replace(unnecessaryAttributesRegex, '')
    }

    function removeComments(html: string): string {
      const commentRegex = /<!--[\s\S]*?-->/g
      return html.replace(commentRegex, '')
    }

    const cleanedHtml = [removeScriptAndStyleTags, removeInlineEventHandlers, removeUnnecessaryAttributes, removeComments].reduce(
      (html, cleaningStep) => cleaningStep(html),
      rawHtml
    )

    return `${cleanedHtml}`
  }
}

export interface ParseCandidate {
  parser: ParserName
  parseRes?: Preparse
  error?: string
}
