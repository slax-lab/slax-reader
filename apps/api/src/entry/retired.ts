import { DurableObject } from 'cloudflare:workers'

// Namespaces these classes created in Core and Edge are kept, not deleted: the live implementations moved to
// the Objects Worker. A Worker that owns such a namespace must keep exporting the class name, so it exports
// these inert stand-ins instead of the implementation. SlaxMcpServer (the removed MCP server) is exported only
// while topology:transition steps 2 and 3 still need it; step 4 deletes its namespaces.
class RetiredObject extends DurableObject {
  async fetch(): Promise<Response> {
    return new Response('Gone', { status: 410 })
  }
}

export class SlaxJieba extends RetiredObject {}
export class SlaxWebSocketServer extends RetiredObject {}
export class ScreenshotBrowser extends RetiredObject {}
export class SlaxMcpServer extends RetiredObject {}
