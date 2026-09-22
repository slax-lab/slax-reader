import { ContextManager } from '../../utils/context'
import { Controller } from '../../decorators/controller'
import { Get } from '../../decorators/route'
import { handleImageProxy } from './imageProxy'

@Controller('/static')
export class ImageController {
  @Get('/image')
  public async forwardImage(ctx: ContextManager, request: Request) {
    return handleImageProxy(ctx, request)
  }
}
