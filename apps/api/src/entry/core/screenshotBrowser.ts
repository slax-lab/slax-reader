import puppeteer, { Browser, connect } from '@cloudflare/puppeteer'
import { DurableObject } from 'cloudflare:workers'
import { withTimeout, deriveScreenshotKey } from '@/utils/async'
import { PuppeteerTimeoutError } from '@/const/err'
import { enforcePublicRequests } from '@/utils/browser'

export class ScreenshotBrowser extends DurableObject {
  static readonly destroy_delay = 60 * 1000

  private bins: Fetcher
  private browser?: Browser
  private browserPromise?: Promise<Browser>
  private storage: DurableObjectStorage

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    //@ts-ignore
    this.bins = env.BROWSER
    this.storage = state.storage
  }

  private async resetDestroyAlarm() {
    try {
      await this.storage.setAlarm(Date.now() + ScreenshotBrowser.destroy_delay)
    } catch (e) {
      console.error(`ScreenshotBrowser: reset alarm failed: ${e}`)
    }
  }

  private async getBrowser() {
    if (this.browser) {
      await this.resetDestroyAlarm()
      return this.browser
    }
    if (!this.browserPromise) {
      this.browserPromise = this.initBrowser()
    }
    return this.browserPromise
  }

  private async initBrowser(): Promise<Browser> {
    try {
      const sessions = await puppeteer.sessions(this.bins)
      const freeSessions = sessions.filter((s: { connectionId?: string }) => !s.connectionId)
      if (freeSessions.length > 0) {
        try {
          this.browser = await connect(this.bins, freeSessions[0].sessionId)
        } catch {
          console.log('ScreenshotBrowser: connect to free session failed, falling back to launch')
        }
      }

      if (!this.browser) {
        this.browser = await puppeteer.launch(this.bins, { keep_alive: 120000 })
      }

      if (!this.browser) {
        throw new Error('ScreenshotBrowser: failed to initialize browser — both connect and launch failed')
      }

      await this.resetDestroyAlarm()
      return this.browser
    } finally {
      this.browserPromise = undefined
    }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const { contentKey } = (await request.json()) as { contentKey: string }
      if (!contentKey) return this.fail('contentKey is required', 400)

      const htmlObj = await this.env.OSS.get(contentKey)
      if (!htmlObj) return this.fail(`HTML not found in R2: ${contentKey}`, 404)
      const html = await htmlObj.text()

      console.log(`ScreenshotBrowser: HTML loaded, key=${contentKey}, length=${html.length}`)

      const browserIns = await withTimeout(this.getBrowser(), 30000, 'Get browser timeout')
      if (!browserIns) throw PuppeteerTimeoutError()

      const browserContext = await browserIns.createBrowserContext()
      try {
        const page = await browserContext.newPage()
        await enforcePublicRequests(page)
        await Promise.all([page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 1 }), page.setBypassCSP(false), page.setJavaScriptEnabled(false)])

        const styledHtml = `<html><head><style>${READER_CSS}</style></head><body>${html}</body></html>`
        try {
          await page.setContent(styledHtml, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        } catch (e) {
          const err = e as Error
          if (!err.message?.includes('Timeout')) {
            return this.fail(`setContent failed: ${err.message}`, 500)
          }
        }

        try {
          await page.waitForNetworkIdle({ timeout: 30_000, idleTime: 1000 })
        } catch {
          console.log('ScreenshotBrowser: network idle timeout, proceeding')
        }

        const unavailableImages = await page.evaluate(() => {
          let count = 0
          document.querySelectorAll('img').forEach(img => {
            if (img.complete && img.naturalWidth > 1 && img.naturalHeight > 1) return

            const rect = img.getBoundingClientRect()
            const declaredWidth = Number(img.getAttribute('width')) || rect.width
            const declaredHeight = Number(img.getAttribute('height')) || rect.height
            const compact = declaredWidth > 0 && declaredWidth <= 80 && declaredHeight > 0 && declaredHeight <= 80
            const placeholder = document.createElement('div')
            placeholder.className = `slax-image-unavailable${compact ? ' slax-image-unavailable-compact' : ''}`
            placeholder.setAttribute('role', 'img')
            placeholder.setAttribute('aria-label', img.alt ? `图片加载失败：${img.alt}` : '图片加载失败')

            const label = document.createElement('strong')
            label.textContent = '图片加载失败（远程截图）'
            placeholder.appendChild(label)

            if (img.alt && !compact) {
              const description = document.createElement('span')
              description.textContent = img.alt
              placeholder.appendChild(description)
            }

            img.replaceWith(placeholder)
            count++
          })
          return count
        })
        if (unavailableImages > 0) console.log(`ScreenshotBrowser: replaced ${unavailableImages} unavailable images with placeholders`)

        const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 80 })

        // 写截图到 R2
        const screenshotKey = deriveScreenshotKey(contentKey)
        await this.env.OSS.put(screenshotKey, screenshotBuffer, { httpMetadata: { contentType: 'image/jpeg' } })

        console.log(`ScreenshotBrowser: saved to R2: ${screenshotKey}`)
        return Response.json({ screenshotKey })
      } finally {
        await browserContext.close()
      }
    } catch (e) {
      console.error(`ScreenshotBrowser: failed: ${e}`)
      return this.fail(`${e}`, 500)
    }
  }

  async alarm() {
    try {
      if (this.browser) {
        await this.browser.close()
        this.browser = undefined
      }
    } catch (e) {
      console.error(`ScreenshotBrowser: alarm error: ${e}`)
    }
  }

  private fail(msg: string, status: number) {
    return Response.json({ error: msg }, { status })
  }
}

const READER_CSS = `:root{color-scheme:light;--slax-text:#333;--slax-text-muted:rgba(51,51,51,.6);--slax-text-light:rgba(51,51,51,.5);--slax-border:rgba(51,51,51,.08);--slax-surface:#f5f5f3;--slax-surface-solid:#fff;--slax-link:#5490c2;--slax-font-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--slax-font-mono:"SFMono-Regular",Consolas,"Liberation Mono",monospace;}*{box-sizing:border-box;}html{background:#fff;}body{position:relative;width:768px;max-width:100%;min-height:100vh;margin:0 auto;padding:40px 48px;background:var(--slax-surface-solid);color:var(--slax-text);font-family:var(--slax-font-sans);font-size:17px;line-height:1.75;overflow-wrap:anywhere;}body>div:first-child>:first-child,body>article:first-child>:first-child{margin-top:0!important;}video,section,pre,p,hr,h1,h2,h3,h4,figure,:not(li) > ul,:not(li) > ol{margin-top:24px !important;white-space:pre-line;}blockquote{border-left:3px solid var(--slax-border);padding-left:12px;color:var(--slax-text-muted);line-height:24px;}table{width:100% !important;border-collapse:separate;border-spacing:0;border:1px solid var(--slax-border);border-radius:8px;overflow:hidden;}th,tr,td{text-align:left;border-bottom:1px solid var(--slax-border);padding:11px 16px;}th{background:var(--slax-surface);font-weight:600;}a{color:var(--slax-link);text-decoration:none;border:none;cursor:pointer;}div > img,section > img,figure > img,picture,picture > img,video{width:100% !important;}img{max-width:100%;height:auto;object-fit:contain;border-radius:12px;}img + img{margin-top:10px !important;}.slax-image-unavailable{display:flex;width:100%;min-height:160px;margin-top:24px;padding:24px;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px dashed rgba(51,51,51,.28);border-radius:8px;background:var(--slax-surface);color:var(--slax-text-muted);text-align:center;}.slax-image-unavailable strong{font-size:14px;font-weight:600;}.slax-image-unavailable span{max-width:90%;font-size:12px;line-height:1.5;}.slax-image-unavailable-compact{width:64px;min-height:64px;margin:0;padding:6px;flex:0 0 64px;border-radius:50%;}.slax-image-unavailable-compact strong{font-size:10px;line-height:1.25;}img.slax-image-loading{background:linear-gradient(
    135deg,#f5f5f3 0%,rgba(153,153,153,0.31) 100%
  );background-size:400% 400%;animation:imageLoading 3s ease infinite;width:100%;height:100px;}img[onerror="this.style.display='none'"],img:not([src]):not([srcset]){display:none;}pre{padding:16px;max-width:100%;background-color:#e5e7eb;border-radius:4px;text-align:left;white-space:pre-wrap;font-family:"Courier New",Courier,monospace !important;}pre code{max-width:100%;display:block;white-space:pre;font-family:"Courier New",Courier,monospace !important;overflow-x:auto;}pre code *{font-family:"Courier New",Courier,monospace !important;}pre code span p{display:inline;}code{text-align:left;background-color:#e5e7eb;padding:2px 6px;border-radius:3px;}h1{font-size:24px;line-height:36px;font-weight:bold;}h2,h3,h4,h5{font-size:20px;line-height:30px;font-weight:600;}ul{list-style:none;padding-left:0;}ul.has-li{padding-left:26px;}ul > li{position:relative;margin-left:20px;}ul > li::before{content:"";position:absolute;background-color:#333333;width:4px;height:4px;border-radius:50%;top:11px;left:-20px;}ol{padding-left:26px;list-style:none;counter-reset:list-counter;}ol > li{position:relative;counter-increment:list-counter;}ol > li::marker{content:"";}ol > li::before{position:absolute;border-radius:50%;top:1px;left:-26px;content:counter(list-counter) ". ";}li li::before{content:none;}iframe[src]{min-height:400px;width:100%;border:none;}::selection{background:#8ad8a866;}@keyframes imageLoading{0%{background-position:0% 50%;}50%{background-position:100% 50%;}100%{background-position:0% 50%;}}.zhihu-qa-answer{margin-top:28px!important;padding:20px;border:1px solid #dfe3e8;border-radius:8px;background:#fff;}.zhihu-qa-user{display:flex;align-items:center;gap:12px;}.zhihu-qa-avatar{display:block;width:40px!important;height:40px!important;min-width:40px;max-width:40px!important;flex:0 0 40px;object-fit:cover;border-radius:50%!important;clip-path:circle(50%);}.zhihu-qa-user-info{min-width:0;display:flex;flex-direction:column;}.zhihu-qa-user-name{color:#24292f;font-size:16px;font-weight:600;line-height:22px;}.zhihu-qa-user-headline{margin-top:2px;color:#6e7781;font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.zhihu-qa-answer-meta{margin-top:12px!important;margin-bottom:16px;color:#6e7781;font-size:13px;border-bottom:1px solid #edf0f2;padding-bottom:12px;}.zhihu-qa-answer-content>:first-child{margin-top:0!important;}.tweet-content{margin-top:32px;white-space:pre-line;}.social-post-content{margin-top:32px;white-space:pre-line;}.social-post-media{margin-top:28px;}.social-post-title{font-weight:bold;}.social-post-tags{margin-top:10px;}.social-post-tag{margin-right:6px;color:#5490c2;}.quote-tweet-container{margin-top:28px;position:relative;border:1px solid #e1e8ed;border-radius:8px;padding:15px;transition:background-color 250ms;}.quote-tweet-container:hover{background-color:#f5f8fa;}.quote-tweet-container .quote-tweet{margin-top:0 !important;}.quote-tweet-container .quote-tweet .quote-header{display:flex;justify-content:start;align-items:center;}.quote-tweet-container .quote-tweet .quote-header img{width:32px !important;height:32px;border-radius:16px;overflow:hidden;}.quote-tweet-container .quote-tweet .quote-header .quote-title{font-weight:bold;font-size:14px !important;color:#333 !important;}.quote-tweet-container .quote-tweet .quote-header img + .quote-title{margin-left:10px !important;}.quote-tweet-container .quote-tweet .quote-description{margin-top:10px;font-size:14px;color:#555;}.quote-tweet-container .quote-tweet .quote-media{width:100%;}.quote-tweet-container .quote-tweet .quote-media img{max-width:100%;border-radius:8px;margin-top:10px;}.quote-tweet-container .quote-tweet .quote-link{position:absolute;inset:0;opacity:0;}`
