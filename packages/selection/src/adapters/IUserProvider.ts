/**
 * 用户信息提供者适配器接口
 *
 * 用于统一dweb和extensions的用户信息获取方式
 * - dweb: 从Pinia store获取
 * - extensions: 从config传入
 */
export interface IUserProvider {
  /**
   * 获取当前用户ID
   * @returns 用户ID，未登录返回null
   */
  getUserId(): number | null

  /**
   * 获取当前用户信息
   * @returns 用户信息对象，未登录返回null
   */
  getUserInfo(): { userId: number; name: string; email: string; picture: string } | null
}
