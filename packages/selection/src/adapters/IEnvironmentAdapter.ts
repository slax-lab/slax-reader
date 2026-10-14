/**
 * 环境适配器接口
 *
 * 用于统一dweb和extensions的环境差异
 * - dweb: 支持iframe，需要访问iframe的document和window
 * - extensions: 直接访问当前页面的document和window
 */
export interface IEnvironmentAdapter {
  /**
   * 获取目标window对象
   * @returns Window对象
   */
  getWindow(): Window

  /**
   * 获取目标document对象
   * @returns Document对象
   */
  getDocument(): Document

  /**
   * 获取Selection对象
   * @returns Selection对象，如果不存在返回null
   */
  getSelection(): Selection | null
}
