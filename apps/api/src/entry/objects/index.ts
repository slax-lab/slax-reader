import { SlaxJieba } from '@/utils/hybridSearch/jieba'
import { SlaxWebSocketServer } from '@/infra/message/websocket'
import { ScreenshotBrowser } from './screenshotBrowser'

// Objects owns the stateless Durable Objects. Other Workers reach them only through namespace bindings.
export default {
  async fetch(): Promise<Response> {
    return new Response('Not Found', { status: 404 })
  }
}

export { SlaxJieba, SlaxWebSocketServer, ScreenshotBrowser }
