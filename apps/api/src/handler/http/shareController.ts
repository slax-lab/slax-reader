import { ErrorParam } from '../../const/err'
import { RequestUtils } from '../../utils/requestUtils'
import { Failed, Successed } from '../../utils/responseUtils'
import { inject } from '../../decorators/di'
import { ShareService } from '../../domain/share'
import { Controller } from '../../decorators/controller'
import { Get, Post } from '../../decorators/route'
import { ContextManager } from '@/utils/context'
import { ShareOrchestrator } from '../../domain/orchestrator/share'
import { updateBookmarkShareReq } from '../../domain/share'

@Controller('/v1/share')
export class ShareController {
  constructor(
    @inject(ShareService) private shareService: ShareService,
    @inject(ShareOrchestrator) private shareOrchestrator: ShareOrchestrator
  ) {}

  /**
   * 获取分享详情
   */
  @Get('/detail')
  public async getShare(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ share_code: string }>(request)
    if (!req || !req.share_code || req.share_code.length < 1) return Failed(ErrorParam())

    const shareDetail = await this.shareOrchestrator.getBookmarkByShareCode(ctx, req.share_code)
    return Successed(shareDetail)
  }

  @Get('/inline_detail')
  public async getInlineShare(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ share_code: string }>(request)
    if (!req || !req.share_code || req.share_code.length < 1) return Failed(ErrorParam())

    const shareDetail = await this.shareOrchestrator.getInlineShareDetail(ctx, req.share_code)
    return Successed(shareDetail)
  }

  /**
   * 更新分享
   */
  @Post('/update')
  public async updateShare(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<updateBookmarkShareReq>(request)
    if (!req) return Failed(ErrorParam())

    const res = await this.shareService.updateBookmarkShare(ctx, req)
    return Successed(res)
  }

  /**
   * 删除分享
   */
  @Post('/delete')
  public async deleteShare(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ bookmark_id: number }>(request)
    if (!req) return Failed(ErrorParam())

    await this.shareService.deleteBookmarkShare(ctx, req.bookmark_id)
    return Successed('ok')
  }

  /**
   * 检查分享是否存在
   */
  @Get('/exists')
  public async existsShare(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ bookmark_id?: number; bookmark_uid?: string }>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid)) return Failed(ErrorParam())

    const res = await this.shareService.checkBookmarkShareExists(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid })
    return Successed(res)
  }

  /**
   * 获取分享划线列表
   */
  @Get('/mark_list')
  public async getMarkList(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ share_code?: string; bookmark_uid?: string }>(request)
    if (!req || (!req.share_code && !req.bookmark_uid)) return Failed(ErrorParam())

    const markList = req.bookmark_uid
      ? await this.shareOrchestrator.getBookmarkShareMarkListByUid(ctx, req.bookmark_uid)
      : await this.shareOrchestrator.getBookmarkShareMarkList(ctx, req.share_code!)
    return Successed(markList)
  }
}
