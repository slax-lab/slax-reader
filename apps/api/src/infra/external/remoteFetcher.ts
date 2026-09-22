import { base64UrlDecode } from '@/utils/webpush/utils'
import { fetchResponse, fetchResult } from '@/utils/browser'
import { publicFetch } from '@/utils/publicFetch'
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
