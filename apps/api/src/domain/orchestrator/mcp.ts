import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { container } from '@/decorators/di'
import { BookmarkService } from '@/domain/bookmark'
import { SearchService } from '@/domain/search'
import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { ContentParser } from '@/utils/parser'
import { BookmarkNotFoundError, BookmarkContentNotFoundError } from '@/const/err'
import { aboutSlax } from '@/const/prompt'
import { McpAgent } from 'agents/mcp'
import { State } from 'cloudflare/resources/cache/cache-reserve.mjs'
import { requireActiveUser } from '@/utils/activeUser'

export type Props = {
  userId: number
  lang: string
}

export type BookmarkItem = { title: string; desc: string; byline: string; publishedTime: string; id: number }

export class SlaxMcpServer extends McpAgent<Env, State, Props> {
  protected get requestProps(): Props {
    if (!this.props) throw new Error('MCP request identity is missing')
    return this.props
  }

  server = new McpServer({
    name: 'Slax Reader MCP Server',
    version: '0.0.1'
  })

  async init() {
    const { initializeInfrastructure, initializeCore } = await import('../../di/generated/dependency')
    initializeCore()
    const authenticated =
      <Args extends unknown[], Result>(handler: (scope: ReturnType<typeof container.clone>, ...args: Args) => Promise<Result>) =>
      async (...args: Args): Promise<Result> => {
        const ctx = new ContextManager({} as ExecutionContext, this.env)
        const scope = container.clone()
        try {
          initializeInfrastructure(ctx, scope)
          await requireActiveUser(scope, this.requestProps.userId)
          return await handler(scope, ...args)
        } finally {
          await ctx.cleanup()
        }
      }

    // claude mcp add --transport sse slax_reader http://localhost:8787/v1/mcp/sse --header "authorization: "
    this.server.tool(
      'list_bookmark',
      'get bookmark list. when the `query` is empty, pagination is allowed with a fixed size of 5. When the `query` is not empty, 10 items are returned at once and pagination is not available.',
      {
        query: z.string().describe('search query term, default is empty'),
        page: z.number().describe('page number, default is 1')
      },
      authenticated(async (mcpContainer, { query, page }: { query: string; page: number }) => {
        query = query.replaceAll('"', '')
        console.log('MCP search bookmark:', query, 'page:', page)
        const result: BookmarkItem[] = []
        const bmSvc = mcpContainer.resolve(BookmarkService)
        const searchSvc = mcpContainer.resolve(SearchService)
        const ctx = new ContextManager({} as ExecutionContext, this.env)

        ctx.setHashIds(new Hashid(this.env, this.requestProps.userId))
        ctx.setUserInfo(this.requestProps.userId, ctx.hashIds.encodeId(this.requestProps.userId), '', this.requestProps.lang)

        if (query === '') {
          const bmList = await bmSvc.bookmarkList(ctx, page, 10, 'all')
          bmList.forEach((bm: any) => {
            result.push({
              title: bm.title,
              desc: bm.description || '',
              byline: bm.byline || '',
              publishedTime: bm.published_at ? bm.published_at.toISOString() : '',
              id: bm.id
            })
          })
        } else {
          const searchList = await searchSvc.hybridSearch(ctx, query)
          searchList.forEach(item => {
            result.push({
              title: item.highlight_title,
              desc: item.highlight_content,
              byline: '',
              publishedTime: '',
              id: item.bookmark_id
            })
          })
        }

        return {
          content: [
            { type: 'text', text: `find ${result.length} bookmark` },
            ...result.map(item => ({
              type: 'resource' as const,
              resource: {
                text: '',
                uri: `bookmark://content/${item.id}`,
                _meta: {
                  title: item.title,
                  description: item.desc,
                  byline: item.byline,
                  publishedTime: item.publishedTime,
                  overview_link: `bookmark://overview/${item.id}`
                }
              }
            }))
          ]
        }
      })
    )

    this.server.registerResource(
      'bookmark_overview',
      'bookmark://overview/{bookmark_id}',
      {
        title: 'Bookmark Overview',
        description: 'Overview of a specific bookmark',
        mimeType: 'text/plain'
      },
      authenticated(async (mcpContainer, uri: URL) => {
        const bookmarkId = this.extractBmId(uri)
        const bmSvc = mcpContainer.resolve(BookmarkService)
        try {
          const summary = await bmSvc.getUserBookmarkSummaryByMCP(bookmarkId, this.requestProps.userId, this.requestProps.lang)
          return {
            contents: [{ uri: uri.href, text: summary?.content || '' }]
          }
        } catch (e) {
          console.error(e)
          return {
            contents: [{ uri: uri.href, text: 'error' }]
          }
        }
      })
    )

    this.server.registerResource(
      'bookmark_content',
      new ResourceTemplate('bookmark://content/{bookmark_id}', {
        list: undefined
      }),
      {
        title: 'Bookmark Content',
        description: 'Content of a specific bookmark',
        mimeType: 'text/plain'
      },
      authenticated(async (mcpContainer, uri: URL) => {
        const bmId = this.extractBmId(uri)
        const bmSvc = mcpContainer.resolve(BookmarkService)
        try {
          const bm = await bmSvc.getUserBookmarkWithDetail(this.requestProps.userId, bmId)
          if (!bm) throw BookmarkNotFoundError()

          const key = bm.bookmark.content_key
          if (!key) throw BookmarkContentNotFoundError()

          const content = await bmSvc.getBookmarkContent(key)
          if (!content) throw BookmarkContentNotFoundError()

          const document = ContentParser.getDocument(content)

          return {
            contents: [{ uri: uri.href, text: document.body.textContent || '' }]
          }
        } catch (e: unknown) {
          console.log(e)
          return {
            contents: [{ uri: uri.href, text: e instanceof Error ? e.message : 'Unknown error' }],
            isError: true
          }
        }
      })
    )

    this.server.resource(
      'about',
      'about://slax',
      authenticated(async (_scope, uri: URL) => ({
        contents: [{ uri: uri.href, text: aboutSlax }]
      }))
    )

    this.server.prompt(
      'slax',
      authenticated(async () => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: aboutSlax } }]
      }))
    )
  }

  public extractBmId(uri: URL): number {
    const pathSegments = uri.pathname.split('/')
    const bookmarkId = pathSegments[pathSegments.length - 1]
    return parseInt(bookmarkId, 10)
  }
}
