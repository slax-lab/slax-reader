import { inject, injectable, singleton } from '../decorators/di'
import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { UserRepo } from '../infra/repository/dbUser'

export interface emailContent {
  from: string
  to: string
  subject: string
  text?: string
}

@injectable()
export class EmailService {
  constructor(@inject(UserRepo) private userRepo: UserRepo) {}

  public async processEmail(ctx: ExecutionContext, env: Env, content: emailContent) {
    const user = await this.userRepo.getUserByPlatform('email', content.to.split('@')[0])
    if (!user) {
      console.log(`User not found: ${content.to}`)
      return
    }
    if (!user.user_id) {
      console.log(`User not found: ${content.to}, ${user}`)
      return
    }

    if (!content.text) {
      console.log(`Content not found: ${content.to}`)
      return
    }
    console.log(`match email content: ${content.text}`)

    const url = content.text.match(`(https?)://[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]`)
    if (!url || url.length < 1) return

    const urlEntity = new URL(url[0])

    const ctxManager = new ContextManager(ctx, env)
    ctxManager.setHashIds(new Hashid(env, user.user_id))
    ctxManager.setUserInfo(user.user_id, new Hashid(env).encodeId(user.user_id), '', '')
    // const bmId = await this.bookmarkService().addUrlBookmark(ctxManager, env, { target_url: urlEntity.toString(), tags: [] }, callbackType.NOT_CALLBACK)
    // console.log(`email process result: ${bmId}`)
  }
}
