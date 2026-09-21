import type { UserInfo } from '@commons/types/interface'
import type { IUserProvider } from '@slax-reader/selection/adapters'

/**
 * Extensions端用户信息提供者
 *
 * 从config中获取用户信息
 */
export class ExtensionsUserProvider implements IUserProvider {
  private userInfo: UserInfo | null

  constructor(userInfo: UserInfo | null) {
    this.userInfo = userInfo
  }

  getUserId(): number | null {
    return this.userInfo?.userId ?? null
  }

  getUserInfo(): { userId: number; name: string; email: string; picture: string } | null {
    if (!this.userInfo) return null

    return {
      userId: this.userInfo.userId,
      name: this.userInfo.name,
      email: this.userInfo.email,
      picture: this.userInfo.picture
    }
  }

  /**
   * 更新用户信息（Extensions特有）
   */
  updateUserInfo(userInfo: UserInfo | null) {
    this.userInfo = userInfo
  }
}
