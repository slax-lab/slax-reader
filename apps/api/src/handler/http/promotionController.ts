import { ContextManager } from '@/utils/context'
import { Controller } from '../../decorators/controller'
import { Get } from '../../decorators/route'
import { RequestUtils } from '@/utils/requestUtils'
import { Failed, Successed } from '@/utils/responseUtils'
import { ErrorParam } from '@/const/err'
import { Post } from '@/decorators/route'
import { inject } from '@/decorators/di'
import { SubscriptionServiceMain } from '@/domain/subscriptionMain'
import { receiveActivityType } from '@/infra/repository/dbSubscription'
import { turnstileAuth } from '@/utils/turnstile'
import { MultiLangError } from '@/utils/multiLangError'

@Controller('/v1/promotion')
export class PromotionController {
  static readonly BLOGGER_RECORD: Record<string, Record<string, string>> = {
    daguang: {
      name: 'daguang',
      avatar: 'https://avatars.githubusercontent.com/u/201758757?s=200&v=4',
      activity_id: 'daguang'
    },
    lenyy: {
      name: 'lenyy',
      avatar: 'https://reader-img.slax.com/koc/lenyy.jpg',
      activity_id: 'lenyy'
    },
    aspirant_diaries: {
      name: 'Aspirant Diaries',
      avatar: 'https://reader-img.slax.com/koc/AspirantDiaries.jpg',
      activity_id: 'aspirant_diaries'
    },
    xlrocket: {
      name: '效率火箭',
      avatar: 'https://reader-img.slax.com/koc/xlrocket.jpg',
      activity_id: 'xlrocket'
    },
    kggg: {
      name: '千克',
      avatar: 'https://reader-img.slax.com/koc/kggg.jpg',
      activity_id: 'kggg'
    },
    growwithdami: {
      name: '大米Jojo',
      avatar: 'https://reader-img.slax.com/koc/growwithdami.jpg',
      activity_id: 'growwithdami'
    },
    jiuyi: {
      name: '九姨小课堂',
      avatar: 'https://reader-img.slax.com/koc/jiuyi.jpg',
      activity_id: 'jiuyi'
    },
    luca: {
      name: 'Luca',
      avatar: 'https://reader-img.slax.com/koc/luca.jpg',
      activity_id: 'luca'
    }
  }

  constructor(@inject(SubscriptionServiceMain) private subscriptionService: SubscriptionServiceMain) {}

  @Get('/blogger_info')
  public async handleGetBloggerRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ blogger: string }>(request)
    if (!req) return Failed(ErrorParam())

    if (Object.prototype.hasOwnProperty.call(PromotionController.BLOGGER_RECORD, req.blogger)) {
      return Successed({
        name: PromotionController.BLOGGER_RECORD[req.blogger].name,
        avatar: PromotionController.BLOGGER_RECORD[req.blogger].avatar,
        activity_type: receiveActivityType.BLOGGER,
        activity_id: PromotionController.BLOGGER_RECORD[req.blogger].activity_id
      })
    } else {
      return Failed(ErrorParam())
    }
  }

  @Post('/check_receive')
  async checkReceiveStatus(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ activity_type: string; activity_id?: string }>(request)
    if (!req || !req.activity_type) return Failed(ErrorParam())

    const res = await this.subscriptionService.checkReceiveStatus(ctx, req.activity_type)
    return Successed({ status: res })
  }

  @Post('/receive')
  public async handleReceiveRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ activity_id?: string; activity_type: string; turnstile_token: string }>(request)
    if (!req || !req.activity_type) return Failed(ErrorParam())

    if (![receiveActivityType.BLOGGER, receiveActivityType.PLATFORM_0527].includes(req.activity_type as receiveActivityType)) {
      return Failed(ErrorParam())
    }
    if (req.activity_type === receiveActivityType.BLOGGER && (!req.activity_id || !Object.prototype.hasOwnProperty.call(PromotionController.BLOGGER_RECORD, req.activity_id))) {
      return Failed(ErrorParam())
    }
    if (req.activity_type !== receiveActivityType.BLOGGER) {
      req.activity_id = undefined
    }

    if (ctx.env.RUN_ENV === 'prod') {
      await turnstileAuth(request.headers.get('CF-Connecting-IP') || '', req.turnstile_token, ctx.env.TURNSTILE_PAYMENT_SECRET_KEY, ErrorParam())
    }

    try {
      const result = await this.subscriptionService.receiveSubscription(ctx, req.activity_type as receiveActivityType, req.activity_id)
      return Successed(result)
    } catch (error) {
      return Failed(error instanceof MultiLangError ? error : ErrorParam())
    }
  }
}
