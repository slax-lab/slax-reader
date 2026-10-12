import { base64UrlDecode } from '@/utils/webpush/utils'
import { fetchResponse, fetchResult } from '@/utils/browser'
import { createPublicFetch, publicFetch } from '@/utils/publicFetch'
import { publicTarget } from '@/utils/publicTargetPolicy'
import { DajialaArticleUnavailableError } from '@/const/err'

export interface ZyteResponse {
  url: string
  statusCode: number
  httpResponseBody: string
  browserHtml: string
}

export interface ScrapingBotResponse {
  status: string
  result: string
  httpCode: number
}

export interface DajialaResponse {
  code: number
  msk?: string
  msg?: string
  content_text?: string
  cost_money?: number
  remain_money?: number
  data?: {
    title?: string
    author?: string
    html?: string
    post_time?: number
    post_time_str?: string
    cover_url?: string
    nickname?: string
    biz?: string
    article_url?: string
    desc?: string
  }
}

const normalizeHtmlCharset = (charset: string): string => {
  const normalized = charset
    .trim()
    .toLowerCase()
    .replace(/^['"]|['"]$/g, '')
  if (['gb2312', 'gbk', 'x-gbk', 'cp936', 'ms936'].includes(normalized)) return 'gb18030'
  return normalized
}

export const decodeHtmlBody = (body: ArrayBuffer): string => {
  const bytes = new Uint8Array(body)
  let charset = 'utf-8'

  if (bytes[0] === 0xff && bytes[1] === 0xfe) charset = 'utf-16le'
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) charset = 'utf-16be'
  else {
    const head = Array.from(bytes.subarray(0, 8192), byte => String.fromCharCode(byte)).join('')
    const declared = head.match(/<meta\b[^>]*\bcharset\s*=\s*["']?\s*([^\s"'/>;]+)/i)?.[1]
    if (declared) charset = normalizeHtmlCharset(declared)
  }

  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

export class FetchError extends Error {
  code: number

  constructor(
    code: number,
    public message: string
  ) {
    super(message)
    this.code = code
  }
}

export class SlaxFetch {
  private priEnv: Env
  private zyteApiKey: string

  constructor(env: Env) {
    this.priEnv = env
    this.zyteApiKey = env.ZYTE_API_KEY
  }

  /** Raw, bounded HTTP for feeds: preserve XML bytes and validate each target redirect. */
  public async zyteResponse(url: string, headers: Headers, options: { maxBytes: number; timeoutMs: number }): Promise<Response> {
    if (!this.zyteApiKey?.trim()) throw new FetchError(503, 'Zyte is unavailable')
    const transport = createPublicFetch(async (target, init) => {
      const allowed = new Set(['accept', 'if-none-match', 'if-modified-since'])
      const response = await publicFetch(
        'https://api.zyte.com/v1/extract',
        {
          method: 'POST',
          signal: init.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(this.zyteApiKey + ':')}` },
          body: JSON.stringify({
            url: target,
            httpResponseBody: true,
            httpResponseHeaders: true,
            followRedirect: false,
            verifyCertificate: true,
            customHttpRequestHeaders: [...new Headers(init.headers)].filter(([name]) => allowed.has(name)).map(([name, value]) => ({ name, value }))
          })
        },
        { maxBytes: Math.ceil(options.maxBytes / 3) * 4 + 64 * 1024, timeoutMs: options.timeoutMs, followRedirects: false }
      )
      if (!response.ok) {
        await response.body?.cancel()
        const headers = new Headers()
        if (response.headers.has('Retry-After')) headers.set('Retry-After', response.headers.get('Retry-After')!)
        return new Response(null, { status: 503, headers })
      }
      const data = (await response.json()) as { url: string; statusCode: number; httpResponseBody?: string; httpResponseHeaders?: { name: string; value: string }[] }
      if (publicTarget(data.url).href !== target || !Number.isInteger(data.statusCode) || data.statusCode < 200 || data.statusCode > 599) {
        throw new FetchError(502, 'Invalid Zyte response')
      }
      const resultHeaders = new Headers()
      for (const { name, value } of data.httpResponseHeaders || []) {
        // Zyte has already decompressed the body. Cookies never leave the transport.
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'].includes(name.toLowerCase())) resultHeaders.append(name, value)
      }
      const encoded = data.httpResponseBody || ''
      if (encoded.length > Math.ceil(options.maxBytes / 3) * 4) throw new FetchError(502, 'Zyte response exceeds byte budget')
      const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0))
      if (bytes.byteLength > options.maxBytes) throw new FetchError(502, 'Zyte response exceeds byte budget')
      const result = new Response([204, 205, 304].includes(data.statusCode) ? null : bytes, { status: data.statusCode, headers: resultHeaders })
      Object.defineProperty(result, 'url', { value: target })
      return result
    })
    return transport(url, { headers }, options)
  }

  public async http(url: string, timezone: string, lang = 'zh'): Promise<fetchResult> {
    try {
      const resp = (await publicFetch(url, {
        method: 'GET',
        headers: {
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Encoding': 'br, gzip',
          Referer: new URL(url).origin
        }
      })) as Response
      if (!resp.ok) {
        throw new FetchError(resp.status, `fetch ${url} failed, response is not ok: ${resp.status}, response: ${await resp.text()}`)
      }
      return { url: resp.url, content: await resp.text() }
    } catch (error) {
      throw new FetchError(500, `http fetch ${url} failed, error: ${error}`)
    }
  }

  public async head(url: string) {
    const res = await publicFetch(url, { method: 'GET' }, { followRedirects: false })
    await res.body?.cancel()

    return {
      statusCode: res.status,
      location: res.headers.get('Location')
    }
  }

  public async headless(url: string): Promise<fetchResult> {
    try {
      url = publicTarget(url).href
      const resp = await this.priEnv.SlaxBrowser.fetch(url, {
        method: 'POST'
      })
      if (!resp.ok) {
        throw new FetchError(resp.status, `BROWSER API Error: ${resp.status} ${resp.statusText}`)
      }
      const data = ((await resp.json()) as fetchResponse).data
      publicTarget(data.url)
      return data
    } catch (e) {
      console.error(`headless fetch failed: ${e}`)
      throw e
    }
  }

  public async zyte(url: string, browserHtml: boolean = false): Promise<fetchResult> {
    url = publicTarget(url).href
    const body = browserHtml
      ? {
          url,
          browserHtml,
          javascript: true
        }
      : {
          url,
          httpResponseBody: true,
          followRedirect: true
        }
    const resp = await publicFetch('https://api.zyte.com/v1/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(this.zyteApiKey + ':')}`,
        'Accept-Encoding': 'gzip, deflate, br'
      },
      body: JSON.stringify(body)
    })
    if (resp.status !== 200) {
      void resp.body?.cancel().catch(() => {})
      throw new FetchError(resp.status, `ZYTE API Error: ${resp.status} ${resp.statusText}`)
    }
    const data = (await resp.json()) as ZyteResponse
    if (data.statusCode >= 400) {
      throw new FetchError(data.statusCode, `ZYTE target fetch failed: ${data.statusCode} for ${url}`)
    }
    return {
      content: browserHtml ? data.browserHtml : decodeHtmlBody(base64UrlDecode(data.httpResponseBody)),
      url: publicTarget(data.url).href,
      title: ''
    }
  }

  public async dajiala(url: string): Promise<fetchResult> {
    url = publicTarget(url).href
    const key = this.priEnv.JIZHILE_API_KEY
    if (!key) {
      throw new FetchError(500, 'JIZHILE_API_KEY is not configured')
    }
    const resp = await publicFetch('https://www.dajiala.com/fbmain/monitor/v3/article_html', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ url, key, verifycode: '' })
    })
    if (resp.status !== 200) {
      const text = await resp.text().catch(() => '')
      throw new FetchError(resp.status, `DAJIALA API HTTP Error: ${resp.status} ${resp.statusText}, body: ${text}`)
    }
    const data = (await resp.json()) as DajialaResponse
    const apiMsg = data.msk || data.msg || 'unknown'

    if (data.code !== 0) {
      throw DajialaArticleUnavailableError(`code=${data.code}, msg=${apiMsg}`)
    }
    if (!data.data || !data.data.html) {
      throw DajialaArticleUnavailableError(`empty content, msg=${apiMsg}, content_text_len=${(data.content_text || '').length}`)
    }

    return {
      content: data.data.html,
      url: publicTarget(data.data.article_url || url).href,
      title: data.data.title || ''
    }
  }

  public async screenshot(contentKey: string): Promise<string> {
    try {
      const doNs = this.priEnv.SCREENSHOT_BROWSER
      const doId = Math.floor(Math.random() * 5)
      const doStub = doNs.get(doNs.idFromName(`${doId}`))
      const resp = await doStub.fetch('http://internal', {
        method: 'POST',
        body: JSON.stringify({ contentKey })
      })
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '')
        throw new FetchError(resp.status, `Screenshot DO Error: ${resp.status}, body: ${errBody.slice(0, 500)}`)
      }

      const { screenshotKey } = (await resp.json()) as { screenshotKey: string }
      return screenshotKey
    } catch (e) {
      console.error(`screenshot failed: ${e}`)
      throw e
    }
  }

  public async scrapingBot(url: string, browserHtml: boolean = false): Promise<fetchResult> {
    url = publicTarget(url).href
    const body = browserHtml
      ? {
          module: 'HtmlChromeScraper',
          params: {
            render: true
          },
          url
        }
      : {
          module: 'HtmlRequestScraper',
          url
        }
    const resp = await publicFetch(`https://api.scrapingrobot.com/?token=${this.priEnv.SCRAPING_BOT_TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body)
    })
    if (resp.status !== 200) {
      console.log(`SCRAPING BOT API Error: ${resp.status} ${resp.statusText}, body: ${await resp.text()}`)
      throw new FetchError(resp.status, `SCRAPING BOT API Error: ${resp.status} ${resp.statusText}`)
    }
    const data = (await resp.json()) as ScrapingBotResponse
    return {
      content: data.result,
      url: url,
      title: ''
    }
  }
}
