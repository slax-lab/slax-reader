import { ErrorParam, UnknownStripePriceId } from '@/const/err'
import { Context, ContextManager } from '@/utils/context'
import { RequestUtils } from '../../utils/requestUtils'
import { Failed, Successed } from '../../utils/responseUtils'
import { turnstileAuth } from '../../utils/turnstile'
import { Controller } from '../../decorators/controller'
import { inject } from '../../decorators/di'
import { SubscriptionServiceMain } from '../../domain/subscriptionMain'
import { Post } from '../../decorators/route'
import { SubscriptionOrchestrator } from '../../domain/orchestrator/subscription'
import { NotificationService } from '../../domain/notification'
import { receiveActivityType } from '@/infra/repository/dbSubscription'
import { SubscriptionAppleService } from '../../domain/subscriptionApple'
import { Get } from '@/decorators/route'

@Controller('/v1/subscription')
export class SubscriptionController {
  constructor(
    @inject(SubscriptionServiceMain) private subscriptionServiceMain: SubscriptionServiceMain,
    @inject(SubscriptionOrchestrator) private subscriptionOrchestrator: SubscriptionOrchestrator,
    @inject(NotificationService) private notificationService: NotificationService,
    @inject(SubscriptionAppleService) private subscriptionAppleService: SubscriptionAppleService
  ) {}

  static checkUserPaymentInfo = async (request: Request, { env, ctx }: Context, token: string) => {
    const ip = request.headers.get('CF-Connecting-IP') || ''

    env.RUN_ENV === 'prod' && (await turnstileAuth(ip, token, env.TURNSTILE_PAYMENT_SECRET_KEY, UnknownStripePriceId()))

    ctx.set('country', request.cf?.country || '')
    ctx.set('continent', request.cf?.continent || '')
  }

  @Post('/create')
  async createSubscription(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ price_id: string }>(request)
    if (!req || !req.price_id) return Failed(ErrorParam())

    const linkRes = await this.subscriptionServiceMain.createPaymentLink(ctx, req.price_id)
    return Successed({ linkRes })
  }

  @Post('/create_once')
  async createOnceSubscription(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ price_id: string; token: string }>(request)
    if (!req || !req.price_id || !req.token) return Failed(ErrorParam())

    await SubscriptionController.checkUserPaymentInfo(request, { env: ctx.env, ctx }, req.token)

    const payCs = await this.subscriptionServiceMain.createOncePaymentIntent(ctx, req.price_id)
    return Successed({ client_secret: payCs })
  }

  @Post('/create_subscription')
  async createSubscriptionPaymentIntent(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ once_price_id: string; sub_price_id: string; token: string }>(request)
    if (!req || !req.sub_price_id || !req.token) return Failed(ErrorParam())

    await SubscriptionController.checkUserPaymentInfo(request, { env: ctx.env, ctx }, req.token)

    const payCs = await this.subscriptionServiceMain.createPaymentIntent(ctx, req.once_price_id, req.sub_price_id)
    return Successed({ client_secret: payCs })
  }

  @Post('/cancel')
  async cancelSubscription(ctx: ContextManager, request: Request): Promise<Response> {
    await this.subscriptionServiceMain.cancelUserSubscription(ctx)
    return Successed('ok')
  }

  @Post('/redeem')
  async redeemSubscription(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ code: string }>(request)
    if (!req || !req.code) return Failed(ErrorParam())

    await this.subscriptionServiceMain.redeemSubscription(ctx, req.code)
    return Successed('ok')
  }

  @Post('/receive')
  async receiveSubscription(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ activity: string; turnstile_token: string }>(request)
    if (!req || req.activity !== receiveActivityType.PLATFORM_0527) return Failed(ErrorParam())

    if (ctx.env.RUN_ENV === 'prod') {
      await turnstileAuth(request.headers.get('CF-Connecting-IP') || '', req.turnstile_token, ctx.env.TURNSTILE_PAYMENT_SECRET_KEY, ErrorParam())
    }

    const message = await this.subscriptionServiceMain.receiveSubscription(ctx, req.activity as receiveActivityType)
    return Successed(message)
  }

  @Post('/check_receive')
  async checkReceiveStatus(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ activity: string }>(request)
    if (!req || !req.activity) return Failed(ErrorParam())

    const res = await this.subscriptionServiceMain.checkReceiveStatus(ctx, req.activity)
    return Successed({ status: res })
  }

  @Get('/user_inapp_purchase')
  async getUserIapSubscriptionInfo(ctx: ContextManager, request: Request): Promise<Response> {
    const res = await this.subscriptionAppleService.getAppleIAPSubscriptionInfo(ctx)
    return Successed(res)
  }

  @Post('/create_inapp_purchase')
  async handleCreateIapOrderId(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ platform: string; product_id: string; offer_id?: string }>(request)
    if (!req || !req.product_id) return Failed(ErrorParam())

    const res = await this.subscriptionAppleService.createAppleIAPSubscription(ctx, req.product_id, req.offer_id)
    return Successed(res)
  }

  @Post('/check_inapp_purchase')
  async handleCheckIapOrderPurchase(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{
      platform: string
      product_id: string
      order_id: string
      jws_representation: string
    }>(request)

    if (!req || !req.platform || !req.product_id || !req.order_id || !req.jws_representation) {
      return Failed(ErrorParam())
    }

    const res = await this.subscriptionAppleService.checkAppleIAPSubscription(ctx, req.product_id, req.order_id, req.jws_representation)
    return Successed({ ok: res })
  }

  @Get('/apple_inapp_products')
  async handleGetAppleIapProducts(ctx: ContextManager, request: Request): Promise<Response> {
    const res = await this.subscriptionAppleService.getAppleIAPProductList(ctx)
    return Successed({ products: res })
  }
}
