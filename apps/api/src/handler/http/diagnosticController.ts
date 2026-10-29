import { Controller } from '@/decorators/controller'
import { inject } from '@/decorators/di'
import { Get } from '@/decorators/route'
import { UserService } from '@/domain/user'
import { ContextManager } from '@/utils/context'

@Controller('/v1/diagnostics')
export class DiagnosticController {
  constructor(@inject(UserService) private userService: UserService) {}

  @Get('/download')
  public async download(ctx: ContextManager, request: Request) {
    return this.userService.downloadDiagnostic(ctx, request)
  }
}
