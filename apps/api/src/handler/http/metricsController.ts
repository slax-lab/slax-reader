import { ContextManager } from '@/utils/context'
import { Controller } from '../../decorators/controller'
import { Post, Get } from '../../decorators/route'
import { inject } from '../../decorators/di'
import { Successed, Failed } from '../../utils/responseUtils'
import { RequestUtils } from '../../utils/requestUtils'
import { DashboardService } from '../../domain/dashboard'
import { ErrorParam } from '@/const/err'
import { LogsService } from '../../domain/logs'

@Controller('/')
export class MetricsController {
  constructor(
    @inject(DashboardService) private dashboardService: DashboardService,
    @inject(LogsService) private logsService: LogsService
  ) {}

  @Get('/m')
  public async handleHeartbeatRequest(ctx: ContextManager, request: Request) {
    const clientType = request.headers.get('X-CLIENT-TYPE') || ''
    const actionType = request.headers.get('X-ACTION-TYPE') || ''
    const actionVersion = request.headers.get('X-CLIENT-VERSION') || ''

    if (!actionType) return Failed(ErrorParam())

    ctx.execution.waitUntil(
      this.logsService.track(ctx.getUserId(), actionType, {
        platform: clientType,
        version: actionVersion,
        user_agent: request.headers.get('User-Agent')?.slice(0, 512) || undefined,
        referrer: request.headers.get('Referer')?.slice(0, 512) || undefined
      })
    )

    return Successed(null, 200, 'ok')
  }

  @Post('/m/dashboard')
  public async handleDashboardAuth(ctx: ContextManager, request: Request) {
    return Successed('ok')
  }

  @Post('/m/dashboard/metrics_overall')
  public async handleOverallMetrics(ctx: ContextManager, request: Request) {
    const body = await RequestUtils.json<{ start_time: string; end_time: string }>(request)
    if (!body.start_time || !body.end_time) return Failed('start_time and end_time are required')

    const data = await this.dashboardService.getOverallMetrics(body.start_time, body.end_time)
    return Successed(data)
  }

  @Post('/m/dashboard/metrics_platform')
  public async handleMetricsByPlatform(ctx: ContextManager, request: Request) {
    const body = await RequestUtils.json<{ start_time: string; end_time: string }>(request)
    if (!body.start_time || !body.end_time) return Failed('start_time and end_time are required')

    const data = await this.dashboardService.getMetricsByPlatform(body.start_time, body.end_time)
    return Successed(data)
  }

  @Post('/m/dashboard/metrics_daily')
  public async handleDailyMetrics(ctx: ContextManager, request: Request) {
    const body = await RequestUtils.json<{ start_time: string; end_time: string }>(request)
    if (!body.start_time || !body.end_time) return Failed('start_time and end_time are required')

    const data = await this.dashboardService.getDailyMetrics(body.start_time, body.end_time)
    return Successed(data)
  }

  @Post('/m/dashboard/visit_overview')
  public async handleVisitOverview(ctx: ContextManager, request: Request) {
    const body = await RequestUtils.json<{ start_time: string; end_time: string }>(request)
    if (!body.start_time || !body.end_time) return Failed('start_time and end_time are required')

    const data = await this.dashboardService.getVisitOverview(body.start_time, body.end_time)
    return Successed(data)
  }

  @Post('/m/dashboard/top_articles')
  public async handleTopArticles(ctx: ContextManager, request: Request) {
    const body = await RequestUtils.json<{ start_time: string; end_time: string; limit?: number }>(request)
    if (!body.start_time || !body.end_time) return Failed('start_time and end_time are required')

    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100)
    const data = await this.dashboardService.getTopArticles(body.start_time, body.end_time, limit)
    return Successed(data)
  }

  @Post('/m/dashboard/bookmark_steps')
  public async handleBookmarkSteps(ctx: ContextManager, request: Request) {
    const body = await RequestUtils.json<{ start_time: string; end_time: string }>(request)
    if (!body.start_time || !body.end_time) return Failed('start_time and end_time are required')

    const data = await this.dashboardService.getBookmarkStepSuccess(body.start_time, body.end_time)
    return Successed(data)
  }
}
