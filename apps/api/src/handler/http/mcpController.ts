import { Controller } from '../../decorators/controller'
import { All } from '../../decorators/route'
import { SlaxMcpServer } from '../../domain/orchestrator/mcp'
import { ContextManager } from '@/utils/context'

@Controller('/v1/mcp')
export class McpServerController {
  @All('/*')
  async handleMcpRequest(ctx: ContextManager, request: Request) {
    // @ts-ignore
    ctx.execution.props = {
      userId: ctx.getUserId(),
      lang: ctx.getlang()
    }
    return SlaxMcpServer.serveSSE('/v1/mcp/sse').fetch(request, ctx.env, ctx.execution)
  }
}
