import type { UpdateShareCollectionRequest, SubscribeCollectionRequest, CollectionCodeRequest } from '@slax-reader/contracts'
import { inject } from '../../decorators/di'
import { ErrorParam, ShareCollectionNotFoundError } from '../../const/err'
import { Controller } from '../../decorators/controller'
import { Get, Post } from '../../decorators/route'
import { ContextManager } from '@/utils/context'
import { RequestUtils } from '../../utils/requestUtils'
import { Failed, Successed } from '../../utils/responseUtils'
import { CollectionService } from '../../domain/collection'
import { CollectionOrchestrator } from '../../domain/orchestrator/collection'
import { submitServerEvent } from '../../domain/events'

@Controller('/v1/collection')
export class CollectionController {
  constructor(
    @inject(CollectionService) private collectionService: CollectionService,
    @inject(CollectionOrchestrator) private collectionOrchestrator: CollectionOrchestrator
  ) {}

  static collectionCodeIsValidate(collectCode: string) {
    return /^[a-zA-Z0-9]+$/.test(collectCode)
  }

  // 上线一周后，再把它删除
  @Get('/')
  public async handleShareCollectRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.query<CollectionCodeRequest>(request)
    if (!params || !params.collect_code) return Failed(ErrorParam())

    const page = 1
    const size = 10

    const collectionInfo = await this.collectionService.getShareCollectionInfo(ctx, params.collect_code, page, size)

    return Successed(collectionInfo)
  }

  // 公开：合集主人名+头像
  @Get('/owner_info')
  public async handleCollectionOwnerInfoRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.query<{ code: string }>(request)
    if (!params || !params.code || !CollectionController.collectionCodeIsValidate(params.code)) return Failed(ErrorParam())

    const info = await this.collectionService.getCollectionOwnerInfo(params.code)
    if (!info) return Failed(ShareCollectionNotFoundError())

    return Successed(info)
  }

  // 管理页：自有合集信息
  @Get('/mine')
  public async handleMyShareCollectRequest(ctx: ContextManager, _request: Request) {
    const info = await this.collectionService.getMyShareCollectInfo(ctx)
    return Successed(info)
  }

  /**
   * 设置收藏分享信息
   */
  @Post('/setting')
  public async handleUserSettingShareCollectRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.json<UpdateShareCollectionRequest>(request)
    if (!params || !params.name) return Failed(ErrorParam())

    await this.collectionOrchestrator.updateUserShareCollect(ctx, params)
    return Successed('ok')
  }

  /**
   * 订阅收藏
   */
  @Post('/subscribe')
  public async handleUserCollectionSubscribeRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.json<SubscribeCollectionRequest>(request)
    if (!params || !params.collect_code) return Failed(ErrorParam())
    if (!CollectionController.collectionCodeIsValidate(params.collect_code)) return Failed(ShareCollectionNotFoundError())

    // 仅观测用，截断防超长
    const referrer = typeof params.referrer === 'string' ? params.referrer.slice(0, 512) : undefined
    const subInfo = await this.collectionOrchestrator.subscribeUserCollection(ctx, params.collect_code, referrer)
    if (subInfo.subscribe) submitServerEvent(ctx, request, 'collection_subscribed', { collection_id: params.collect_code })
    return Successed(subInfo)
  }

  /**
   * 取消订阅收藏
   */
  @Post('/unsubscribe')
  public async handleUserCollectionUnsubscribeRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.json<CollectionCodeRequest>(request)
    if (!params || !params.collect_code) return Failed(ErrorParam())
    if (!CollectionController.collectionCodeIsValidate(params.collect_code)) return Failed(ShareCollectionNotFoundError())

    await this.collectionOrchestrator.unsubscribeUserCollection(ctx, params.collect_code)
    try {
      const current = await this.collectionService.getUserCollectionSubscribed(ctx, params.collect_code)
      if (!current.subscribed || current.deleted) submitServerEvent(ctx, request, 'collection_unsubscribed', { collection_id: params.collect_code })
    } catch (error) {
      console.error('[events] failed to verify collection unsubscribe:', error)
    }
    return Successed('ok')
  }

  /**
   * 删除订阅
   */
  @Post('/delete_subscribe')
  public async handleUserCollectionDeleteSubscribeRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.json<CollectionCodeRequest>(request)
    if (!params || !params.collect_code) return Failed(ErrorParam())
    if (!CollectionController.collectionCodeIsValidate(params.collect_code)) return Failed(ShareCollectionNotFoundError())

    await this.collectionService.deleteUserCollectionSubscribe(ctx, params.collect_code)
    return Successed('ok')
  }

  /**
   * 获取当前用户订阅的收藏
   */
  @Post('/subscribed')
  public async handleUserCollectionSubscribedRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.json<CollectionCodeRequest>(request)
    if (!params || !params.collect_code) return Failed(ErrorParam())
    if (!CollectionController.collectionCodeIsValidate(params.collect_code)) return Failed(ShareCollectionNotFoundError())

    const subInfo = await this.collectionService.getUserCollectionSubscribed(ctx, params.collect_code)
    return Successed(subInfo)
  }

  /**
   * 获取当前用户订阅的收藏列表
   */
  @Get('/subscribed_list')
  public async handleUserCollectionSubscribedListRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.query<{ page: number; page_size: number }>(request)
    if (!params || !params.page || !params.page_size) return Failed(ErrorParam())

    const subList = await this.collectionService.getUserCollectionSubscribedList(ctx, params.page, params.page_size)
    return Successed(subList)
  }

  /**
   * 获取当前用户订阅的收藏详情
   */
  @Get('/bookmark')
  public async handleUserCollectionSubscribedDetailRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.query<{ collection_code: string; cb_id: number }>(request)
    if (!params || !params.collection_code || !params.cb_id) return Failed(ErrorParam())
    if (!CollectionController.collectionCodeIsValidate(params.collection_code)) return Failed(ShareCollectionNotFoundError())

    params.cb_id = ctx.hashIds.decodeId(params.cb_id)
    if (!params.cb_id) return Failed(ShareCollectionNotFoundError())

    const detail = await this.collectionOrchestrator.getCollectionBookmarkDetail(ctx, params.collection_code, params.cb_id)
    return Successed(detail)
  }
}
