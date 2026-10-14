import { Consumer } from '../../decorators/queue'
import { inject, injectable } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
import { UserDeletionService } from '../../domain/userDeletion'

export interface UserDeletionMessage {
  userId: number
}

@injectable()
export class UserDeletionConsumer {
  constructor(@inject(UserDeletionService) private userDeletionService: UserDeletionService) {}

  @Consumer({ channel: 'slax-reader-user-deletion' })
  @Consumer({ channel: 'slax-reader-user-deletion-beta' })
  public async handleUserDeletion(ctx: ContextManager, info: { id: string; info: UserDeletionMessage }) {
    const userId = info.info.userId
    console.log(`Starting user deletion process for userId: ${userId}`)

    try {
      await this.userDeletionService.cleanupUserData(userId)
      console.log(`User deletion completed successfully for userId: ${userId}`)
    } catch (error) {
      console.error(`User deletion failed for userId: ${userId}`, error)
      throw error
    }
  }
}
