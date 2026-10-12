import { browserParams, SlaxBrowser } from '@/utils/browser'
import { Failed } from '@/utils/responseUtils'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      // @ts-ignore
      const obj = env.SLAX_BROWSER
      const doId = Math.floor(Math.random() * 5)
      const browser = obj.get(obj.idFromName(`${doId}`))

      if (browser.name) {
        console.log(`headless fetch ${request.url} browser name: ${browser.name}`)
      }

      const reqUrl = new URL(request.url)
      if (reqUrl.pathname === '/screenshot') {
        const resp = (await browser.fetch('http://view/screenshot', {
          method: 'POST',
          body: request.body
        })) as Response

        if (!resp || !resp.ok) {
          const body = await resp.text()
          console.error(`screenshot DO returned ${resp.status}: ${body.slice(0, 200)}`)
          return Failed(
            {
              message: `screenshot failed: ${body.slice(0, 100)}, status: ${resp.status}`
            },
            resp.status || 500
          )
        }

        return new Response(resp.body, {
          headers: { 'Content-Type': 'application/json' }
        })
      }

      const body: browserParams = {
        url: request.url,
        ublock: false,
        width: 1280,
        height: 1960,
        scale: 1,
        timezone: 'Asia/Hong_Kong'
      }
      const init: RequestInit = {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Accept-Encoding': 'br, gzip'
        }
      }

      console.log(`headless fetch ${request.url} init: ${JSON.stringify(init)}`)
      const resp = (await browser.fetch('http://view', init)) as Response

      if (!resp || !resp.ok) {
        const body = await resp.text()
        return Failed({
          message: `headless fetch ${request.url} failed, response is not ok: ${body.slice(0, 100)}, status: ${resp.status}`,
          status: resp.status
        })
      }

      return new Response(resp.body, {
        headers: {
          'Content-Type': 'text/html'
        }
      })
    } catch (error) {
      console.error(`browser-backend entry error: ${error}`)
      return Failed(
        {
          message: `headless fetch ${request.url} failed, error: ${error}`
        },
        500
      )
    }
  }
}

export { SlaxBrowser }
