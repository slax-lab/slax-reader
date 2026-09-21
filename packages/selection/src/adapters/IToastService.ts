/**
 * Toast提示类型
 */
export enum ToastType {
  Success = 'success',
  Error = 'error',
  Warning = 'warning',
  Info = 'info'
}

/**
 * Toast服务适配器接口
 *
 * 用于统一dweb和extensions的Toast通知方式
 * - dweb: 使用CursorToast（跟随光标）或Toast（全局）
 * - extensions: 使用Toast（全局）
 */
export interface IToastService {
  /**
   * 显示普通Toast提示
   * @param options Toast选项
   */
  showToast(options: { text: string; type?: ToastType }): void

  /**
   * 显示跟随光标的Toast提示（可选，extensions可以不实现）
   * @param options Toast选项，包含跟随目标DOM
   */
  showCursorToast?(options: { text: string; trackDom: HTMLElement }): void
}
