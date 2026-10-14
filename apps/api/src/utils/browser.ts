import puppeteer, { Browser, connect, HTTPRequest, HTTPResponse, Page } from '@cloudflare/puppeteer'
import { DurableObject } from 'cloudflare:workers'
import { RequestUtils } from './requestUtils'
import { Failed, Successed } from './responseUtils'
import { withTimeout } from './async'
import { publicTarget } from './publicTargetPolicy'
import { publicFetch } from './publicFetch'

const maxBrowserResourceBytes = 512 * 1024
const browserProxyWaiters: Array<() => void> = []
let browserProxyActive = 0

const acquireBrowserProxy = async (): Promise<() => void> => {
  if (browserProxyActive >= 2) {
    if (browserProxyWaiters.length >= 200) throw new Error('Browser proxy queue full')
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        const index = browserProxyWaiters.indexOf(ready)
        if (index >= 0) browserProxyWaiters.splice(index, 1)
        reject(new Error('Browser proxy queue timeout'))
      }, 10_000)
      browserProxyWaiters.push(ready)
    })
  } else {
    browserProxyActive++
  }
  return () => {
    const next = browserProxyWaiters.shift()
    if (next) next()
    else browserProxyActive--
  }
}

export const enforcePublicRequests = async (page: Page): Promise<void> => {
  await page.setBypassServiceWorker(true)
  let requests = 0
  let totalBytes = 0
  page.on('request', (request: HTTPRequest) => {
    const handle = async () => {
      let release: (() => void) | undefined
      try {
        const url = publicTarget(request.url())
        if (++requests > 200 || totalBytes >= 50 * 1024 * 1024 || !['GET', 'HEAD'].includes(request.method())) throw new Error('Browser request budget exceeded')
        release = await acquireBrowserProxy()
        if (page.isClosed()) throw new Error('Browser page closed')
        const headers = new Headers(Object.entries(request.headers()).filter(([name]) => ['accept', 'accept-language', 'user-agent', 'range'].includes(name.toLowerCase())))
        const response = await publicFetch(url, { method: request.method(), headers }, { maxBytes: maxBrowserResourceBytes, timeoutMs: 10_000, followRedirects: false })
        const body = new Uint8Array(response.body ? maxBrowserResourceBytes : 0)
        let size = 0
        const reader = response.body?.getReader()
        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              totalBytes += value.byteLength
              if (totalBytes > 50 * 1024 * 1024) {
                await reader.cancel()
                throw new Error('Browser page byte budget exceeded')
              }
              body.set(value, size)
              size += value.byteLength
            }
          } finally {
            reader.releaseLock()
          }
        }
        const responseHeaders = Object.fromEntries(
          [...response.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'].includes(name))
        )
        await request.respond({ status: response.status, headers: responseHeaders, body: body.subarray(0, size) })
      } catch {
        await request.abort('blockedbyclient')
      } finally {
        release?.()
      }
    }
    void handle().catch(() => page.close().catch(() => {}))
  })
  await page.setRequestInterception(true)
}

export interface fetchResult {
  content: string
  title?: string
  url: string
}

export interface fetchResponse {
  status: number
  message: string
  data: fetchResult
}

export interface screenshotResult {
  screenshot: string
  url: string
}

export interface screenshotResponse {
  status: number
  message: string
  data: screenshotResult
}

export interface browserParams {
  url: string
  ublock: boolean
  width: number
  height: number
  scale: number
  timezone: string
  requestInterception?: boolean
}

export class SlaxBrowser extends DurableObject {
  static readonly destroy_delay = 60 * 1000

  private bins: Env['BROWSER']
  private browser?: Browser
  private storage: DurableObjectStorage

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.bins = env.BROWSER
    this.storage = state.storage
  }

  private async resetDestroyAlarm() {
    try {
      const alarmTime = Date.now() + SlaxBrowser.destroy_delay
      await this.storage.setAlarm(alarmTime)
    } catch (e) {
      console.error(`Browser DO: reset destroy alarm failed, err: ${e}`)
    }
  }

  private async getBrowser() {
    if (!!this.browser) {
      await this.resetDestroyAlarm()
      return this.browser
    }

    const sessions = await puppeteer.sessions(this.bins)
    if (sessions.length > 0) {
      const idx = Math.floor(Math.random() * sessions.length)
      this.browser = await connect(this.bins, sessions[idx].sessionId)
    } else {
      this.browser = await puppeteer.launch(this.bins, { keep_alive: 120000 })
    }
    if (!this.browser) {
      console.error(`Browser DO: get browser failed, sessions: ${JSON.stringify(sessions)}`)
    } else {
      await this.resetDestroyAlarm()
    }

    return this.browser
  }

  async pageSettings(page: Page, req: browserParams, header: Headers) {
    page.setDefaultTimeout(15000)
    page.setDefaultNavigationTimeout(15000)

    await enforcePublicRequests(page)
    const pagePromise = [page.setBypassCSP(false), page.setCacheEnabled(false), page.setJavaScriptEnabled(false)]

    if (req.width && req.height) {
      pagePromise.push(page.setViewport({ width: req.width, height: req.height, deviceScaleFactor: req.scale }))
    }
    if (header.get('User-Agent')) {
      pagePromise.push(page.setUserAgent(header.get('User-Agent') || ''))
    }
    if (header.get('Accept')) {
      pagePromise.push(page.setExtraHTTPHeaders({ Accept: header.get('Accept') || '' }))
    }
    if (header.get('Accept-Language')) {
      pagePromise.push(page.setExtraHTTPHeaders({ 'Accept-Language': header.get('Accept-Language') || '' }))
    }
    if (header.get('Accept-Encoding')) {
      pagePromise.push(page.setExtraHTTPHeaders({ 'Accept-Encoding': header.get('Accept-Encoding') || '' }))
    }
    await Promise.all(pagePromise)
  }

  async pageScroll(page: Page, limitTimes: number = 5000) {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    let totalTime = 0
    await page.evaluate(async () => {
      await new Promise<void>(resolve => {
        let totalHeight = 0
        const distance = 500
        const timer = setInterval(() => {
          const scrollHeight = document.documentElement.scrollHeight
          window.scrollBy(0, distance)
          totalHeight += distance

          if (totalHeight >= scrollHeight || totalTime > limitTimes) {
            clearInterval(timer)
            resolve()
          }

          totalTime += 100
        }, 100)
      })
    })

    await sleep(500)
  }

  async screenshotFunction(request: Request): Promise<Response> {
    console.log(`Browser DO: Screenshot Request`)
    let browserContext: Awaited<ReturnType<Browser['createBrowserContext']>> | undefined

    try {
      const browserIns = await withTimeout(this.getBrowser(), 7000, 'Get browser timeout')
      if (!browserIns) throw new Error('Failed to get browser instance')

      browserContext = await browserIns.createBrowserContext()
      const page = await browserContext.newPage()
      await enforcePublicRequests(page)
      await Promise.all([page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 1 }), page.setJavaScriptEnabled(false)])

      // body 就是 HTML 原文
      const html = await request.text()

      try {
        await page.setContent(html, {
          waitUntil: 'domcontentloaded',
          timeout: 30 * 1000
        })
      } catch (e) {
        const err = e as Error
        if (!err.name.includes('Timeout') && !err.message.includes('Timeout')) {
          await page.close()
          return Failed(err, 500)
        }
      }

      // 等待网络空闲（图片等资源加载完成），最多30s
      try {
        await page.waitForNetworkIdle({ timeout: 30000, idleTime: 1000 })
      } catch {
        console.log('Browser DO: screenshot network idle timeout, proceeding with screenshot')
      }

      const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'png' })
      const base64 = Buffer.from(screenshotBuffer).toString('base64')

      await page.close()

      return Successed({ screenshot: base64, url: 'screenshot' })
    } catch (e) {
      console.error(`Browser DO: screenshot failed, err: ${e}`)
      return Failed(Error(`Browser DO: screenshot failed, err: ${e}`), 500)
    } finally {
      await browserContext?.close().catch(() => {})
    }
  }

  async fetchFunction(request: Request): Promise<Response> {
    console.log(`Browser DO: Query Browser For Request: ${request.url}`)
    let browserIns: Browser | null = null
    let browserContext: Awaited<ReturnType<Browser['createBrowserContext']>> | undefined

    try {
      await Promise.race([
        new Promise<void>(async resolve => {
          browserIns = await this.getBrowser()
          resolve()
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Get browser timeout')), 7000))
      ]).then(() => {
        console.log(`Browser DO: get page success, start setting page`)
      })

      browserContext = await browserIns!.createBrowserContext()
      const page = await browserContext.newPage()

      const header = request.headers
      const req = await RequestUtils.json<browserParams>(request)
      req.url = publicTarget(req.url).href

      // 设置页面参数
      await this.pageSettings(page, req, header)

      // 不需要等待完全加载，等待body加载完成即可
      let response: HTTPResponse | null = null
      try {
        console.log('Browser DO: fetching:', req.url)
        response = await page.goto(req.url, {
          waitUntil: 'domcontentloaded',
          timeout: 25 * 1000
        })
      } catch (e) {
        const err = e as Error
        if (!err.name.includes('Timeout') && !err.message.includes('Timeout')) {
          console.log(`Browser DO: fetch failed, err: ${err.message}`)
          return Failed(err, 500)
        }
      }

      if (!response || !response.ok()) {
        console.log(`Browser DO: fetch failed, response: ${response?.status()}`)
        return Failed({ content: await response?.text() }, response?.status())
      }

      console.log('start scroll:', req.url)

      const date1 = new Date()

      try {
        await Promise.race([this.pageScroll(page, 5000), new Promise((_, reject) => setTimeout(() => reject(new Error('Scroll timeout')), 6000))])

        const limitTimes = 3000
        console.log('scroll done waiting for network idle:', req.url)
        await Promise.race([
          page.waitForNetworkIdle({
            timeout: limitTimes,
            idleTime: 500
          }),
          page.waitForFunction(() => document.readyState === 'complete', { timeout: limitTimes }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Wait network idle timeout')), limitTimes))
        ])
      } catch (e) {
        console.log('Additional load time exceeded or error:', e, req.url)
      }

      const date2 = new Date()
      console.log('totally scroll cost time:', date2.getTime() - date1.getTime())

      const [contentResult, titleResult, urlResult] = await Promise.allSettled([page.content(), page.title(), page.url()])

      const content = contentResult.status === 'fulfilled' ? contentResult.value : ''
      const title = titleResult.status === 'fulfilled' ? titleResult.value : ''
      const url = publicTarget(urlResult.status === 'fulfilled' ? urlResult.value : req.url).href

      console.log(`fetch ${req.url} done`)

      await page.close()

      return Successed({ content, title, url })
    } catch (e) {
      console.error(`Browser DO: get browser failed, err: ${e}`)
      return Failed(Error(`Browser DO: get browser failed, err: ${e}`))
    } finally {
      await browserContext?.close().catch(() => {})
    }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.pathname === '/screenshot') {
        return await this.screenshotFunction(request)
      }
      return await this.fetchFunction(request)
    } catch (e) {
      console.log(`Browser DO: fetch failed, err: ${e}`)
      return Failed(Error(`Browser DO: fetch failed, err: ${e}`))
    }
  }

  async alarm() {
    try {
      if (this.browser) {
        await this.browser.close()
        this.browser = undefined
      }
    } catch (error) {
      console.error('Error in alarm method:', error)
    }
  }
}
