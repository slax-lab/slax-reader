import type { IUserProvider } from '@slax-reader/selection/adapters'
import { useUserStore } from '~/stores/user'

/**
 * Dweb端用户信息提供者
 *
 * 从Pinia store获取用户信息
 */
export class DwebUserProvider implements IUserProvider {
  getUserId(): number | null {
    const userStore = useUserStore()
    return userStore.userInfo?.userId ?? null
  }

  getUserInfo(): { userId: number; name: string; email: string; picture: string } | null {
    const userStore = useUserStore()
    const userInfo = userStore.userInfo

    if (!userInfo) return null

    return {
      userId: userInfo.userId,
      name: userInfo.name,
      email: userInfo.email,
      picture: userInfo.picture
    }
  }
}
