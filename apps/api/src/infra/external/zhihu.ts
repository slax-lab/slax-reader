import { parseHTML } from 'linkedom'

type JsonObject = Record<string, unknown>
type Capture = { title: string; content: string; author: string }
type Endpoint = 'fetch_answer_detail' | 'fetch_question_detail' | 'fetch_question_answers' | 'fetch_column_article_detail' | 'fetch_pin_detail'
type Diagnostic = {
  endpoint: Endpoint
  attempts: number
  reason: string
  httpStatus?: number
  providerCode?: number
  requestId?: string
}
type Outcome = { data: JsonObject | null; diagnostic: Diagnostic }

const retryDelays = [1000, 2000, 4000]
const terminalCodes = new Set([401, 402, 403, 404, 422, 429])
const object = (value: unknown): JsonObject | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const nonblank = (value: unknown): string => text(value).trim()
const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const escape = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

export class ZhihuCaptureUnavailableError extends Error {
  constructor(diagnostics: Diagnostic[]) {
    super(JSON.stringify(diagnostics))
    this.name = 'ZhihuCaptureUnavailableError'
  }
}

function hasUsableBody(html: string): boolean {
  if (!html.trim()) return false
  const { document } = parseHTML(`<html><body>${html}</body></html>`)
  document.querySelectorAll('script, style, noscript, template, head').forEach(node => node.remove())
  if ((document.body.textContent ?? '').replace(/[\s\u200b-\u200d\ufeff]/g, '')) return true
  return Array.from(document.body.querySelectorAll('img, video, audio, iframe, source')).some(node =>
    ['src', 'data-actualsrc', 'data-original', 'data-src'].some(attribute => {
      const source = nonblank(node.getAttribute(attribute))
      if (!source) return false
      try {
        const { protocol } = new URL(source, 'https://www.zhihu.com')
        return protocol === 'https:' || protocol === 'http:'
      } catch {
        return false
      }
    })
  )
}

function build(title: string, content: string, author = '', articleClass = ''): Capture {
  return {
    title,
    author,
    content: `<html><head><title>${escape(title)}</title><meta name="author" content="${escape(author)}"></head><body><article data-source="zhihu"${articleClass ? ` class="${articleClass}" data-content-type="qa"` : ''}><h1>${escape(title)}</h1>${content}</article></body></html>`
  }
}

function validData(endpoint: Endpoint, data: JsonObject): boolean {
  if (endpoint === 'fetch_question_answers') return Array.isArray(data.data)
  if (endpoint === 'fetch_question_detail') {
    return (typeof data.title === 'string' || typeof data.detail === 'string') && (data.detail === undefined || data.detail === null || typeof data.detail === 'string')
  }
  if (endpoint === 'fetch_pin_detail') return Array.isArray(data.content)
  return (
    (typeof data.content === 'string' || typeof data.title === 'string' || object(data.question) !== null) &&
    (data.content === undefined || data.content === null || typeof data.content === 'string')
  )
}

function retryableCode(code: number, payload: JsonObject): boolean {
  const detail = object(payload.detail)
  const messages = [payload.message, payload.message_zh, payload.detail, detail?.message, detail?.message_zh].map(text).join(' ')
  if (
    /invalid[ _-]*(?:parameter|argument|id)|(?:parameter|argument|id)[^.!。]{0,30}(?:invalid|required)|not found|does not exist|参数(?:错误|无效|缺失|不合法)|(?:内容|问题|回答|文章)(?:不存在|已删除)/i.test(
      messages
    )
  )
    return false
  if (code === 408 || (code >= 500 && code <= 599)) return true
  return code === 400 && /request failed[.!]?\s*please retry|请求失败[，,。.!！\s]*请重试|upstream|temporarily unavailable/i.test(messages)
}

async function attemptRequest(env: Env, endpoint: Endpoint, url: URL, attempt: number): Promise<Outcome & { retry: boolean }> {
  const diagnostic: Diagnostic = { endpoint, attempts: attempt, reason: 'transport' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  let response: Response
  let body: string
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${env.TIKHUB_TOKEN}`, 'Content-Type': 'application/json' },
      signal: controller.signal
    })
    diagnostic.httpStatus = response.status
    body = await response.text()
  } catch {
    diagnostic.reason = controller.signal.aborted ? 'timeout' : 'transport'
    return { data: null, diagnostic, retry: !terminalCodes.has(diagnostic.httpStatus ?? 0) }
  } finally {
    clearTimeout(timeout)
  }

  let payload: JsonObject | null
  try {
    payload = object(JSON.parse(body))
  } catch {
    diagnostic.reason = 'invalid_json'
    return { data: null, diagnostic, retry: response.ok || response.status === 408 || response.status >= 500 }
  }
  if (!payload) {
    diagnostic.reason = 'invalid_payload'
    return { data: null, diagnostic, retry: response.ok || response.status === 408 || response.status >= 500 }
  }

  const detail = object(payload.detail)
  const providerCode = number(detail?.code) ?? number(payload.code)
  if (providerCode !== undefined) diagnostic.providerCode = providerCode
  const requestId = text(detail?.request_id ?? payload.request_id)
  if (/^[a-zA-Z0-9_-]{1,128}$/.test(requestId) && (!env.TIKHUB_TOKEN || !requestId.includes(env.TIKHUB_TOKEN))) {
    diagnostic.requestId = requestId
  }
  if (!response.ok || (providerCode !== undefined && providerCode !== 200)) {
    const code = response.ok ? providerCode! : response.status
    diagnostic.reason = 'provider_error'
    return {
      data: null,
      diagnostic,
      retry: !terminalCodes.has(code) && !terminalCodes.has(providerCode ?? 0) && retryableCode(code, payload)
    }
  }
  const data = object(payload.data)
  if (number(payload.code) === 200 && data && validData(endpoint, data)) {
    return { data, diagnostic: { ...diagnostic, reason: 'success' }, retry: false }
  }
  return { data: null, diagnostic: { ...diagnostic, reason: 'invalid_payload' }, retry: true }
}

async function request(env: Env, endpoint: Endpoint, params: Record<string, string>): Promise<Outcome> {
  const url = new URL(`/api/v1/zhihu/web/${endpoint}`, 'https://api.tikhub.io')
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  let result: Outcome & { retry: boolean }
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]))
    result = await attemptRequest(env, endpoint, url, attempt + 1)
    if (!result.retry || attempt === retryDelays.length) break
  }
  if (!result.data) console.warn('Zhihu content part unavailable', result.diagnostic)
  return result
}

function answerSection(answer: JsonObject): string {
  const user = object(answer.author)
  const author = escape(nonblank(user?.name) || '匿名用户')
  const avatar = escape(text(user?.avatar_url))
  const headline = escape(text(user?.headline))
  const profileUrl = nonblank(user?.url_token) ? `https://www.zhihu.com/people/${escape(user?.url_token)}` : ''
  const id = typeof answer.id === 'string' || (typeof answer.id === 'number' && Number.isSafeInteger(answer.id)) ? answer.id : ''
  const stats = [`${number(answer.voteup_count) ?? 0} 赞同`, `${number(answer.comment_count) ?? 0} 评论`].join(' · ')
  return `<section class="zhihu-qa-answer" data-answer-id="${escape(id)}">
    <div class="zhihu-qa-user">
      ${avatar ? `<img class="zhihu-qa-avatar" data-content-image="avatar" src="${avatar}" alt="${author}" width="40" height="40">` : ''}
      <div class="zhihu-qa-user-info">
        ${profileUrl ? `<a class="zhihu-qa-user-name" href="${profileUrl}">${author}</a>` : `<strong class="zhihu-qa-user-name">${author}</strong>`}
        ${headline ? `<span class="zhihu-qa-user-headline">${headline}</span>` : ''}
      </div>
    </div>
    <p class="zhihu-qa-answer-meta">${stats}</p>
    <div class="zhihu-qa-answer-content">${text(answer.content)}</div>
  </section>`
}

function unavailable(outcome: Outcome): Diagnostic {
  if (!outcome.data) return outcome.diagnostic
  const diagnostic = { ...outcome.diagnostic, reason: 'empty_content' }
  console.warn('Zhihu content part unavailable', diagnostic)
  return diagnostic
}

function requireBody(outcome: Outcome, content: string): void {
  if (!hasUsableBody(content)) throw new ZhihuCaptureUnavailableError([unavailable(outcome)])
}

export async function fetchZhihuByUrl(env: Env, rawUrl: string): Promise<Capture | null> {
  const url = new URL(rawUrl)
  const answerId = url.pathname.match(/^\/(?:question\/\d+\/)?answer\/(\d+)/)?.[1]
  if (answerId) {
    const outcome = await request(env, 'fetch_answer_detail', { answer_id: answerId })
    const content = text(outcome.data?.content)
    requireBody(outcome, content)
    return build(text(object(outcome.data?.question)?.title), content, `ZhiHu: ${text(object(outcome.data?.author)?.name)}`)
  }

  const questionId = url.pathname.match(/^\/question\/(\d+)\/?$/)?.[1]
  if (questionId) {
    const [question, answers] = await Promise.all([
      request(env, 'fetch_question_detail', { question_id: questionId }),
      request(env, 'fetch_question_answers', { question_id: questionId, limit: '20', offset: '0' })
    ])
    const detail = text(question.data?.detail)
    const description = hasUsableBody(detail) ? detail : ''
    const items = (Array.isArray(answers.data?.data) ? answers.data.data : [])
      .map(item => object(object(item)?.target))
      .filter((answer): answer is JsonObject => answer !== null && hasUsableBody(text(answer.content)))
    const diagnostics = [!description ? unavailable(question) : null, !items.length ? unavailable(answers) : null].filter(
      (diagnostic): diagnostic is Diagnostic => diagnostic !== null
    )
    if (!description && !items.length) throw new ZhihuCaptureUnavailableError(diagnostics)
    const title = nonblank(question.data?.title) || items.map(answer => nonblank(object(answer.question)?.title)).find(Boolean) || '知乎问题'
    return build(title, description + items.map(answerSection).join(''), '知乎回答', 'zhihu-qa')
  }

  const articleId = url.pathname.match(/^\/(?:p|appview\/p)\/(\d+)/)?.[1]
  if (articleId) {
    const outcome = await request(env, 'fetch_column_article_detail', { article_id: articleId })
    const content = text(outcome.data?.content)
    requireBody(outcome, content)
    return build(text(outcome.data?.title), content, text(object(outcome.data?.author)?.name))
  }

  const pinId = url.pathname.match(/^\/pin\/(\d+)/)?.[1]
  if (pinId) {
    const outcome = await request(env, 'fetch_pin_detail', { pin_id: pinId })
    const blocks = (Array.isArray(outcome.data?.content) ? outcome.data.content : []).map(object).filter((block): block is JsonObject => block !== null)
    const parts = blocks
      .map(block => ({
        block,
        html: block.type === 'image' && nonblank(block.url) ? `<img src="${escape(block.url)}">` : text(block.content)
      }))
      .filter(part => hasUsableBody(part.html))
    const content = parts.map(part => part.html).join('')
    requireBody(outcome, content)
    const title = parts.find(part => part.block.type === 'text' && nonblank(part.block.title))?.block.title
    return build(nonblank(title) || '知乎想法', content)
  }
  return null
}
