import type { IToastService, ToastType } from '@slax-reader/selection/adapters'
import CursorToast from '~/components/CursorToast'
import Toast from '~/components/Toast'
import { ToastType as LocalToastType } from '~/components/Toast/type'

/**
 * Dweb端Toast服务
 *
 * 支持普通Toast和跟随光标的CursorToast
 */
export class DwebToastService implements IToastService {
  showToast(options: { text: string; type?: ToastType }): void {
    // 将 commons/selection 的 ToastType 转换为本地 ToastType
    let localType: LocalToastType | undefined
    if (options.type) {
      switch (options.type) {
        case 'success':
          localType = LocalToastType.Success
          break
        case 'error':
          localType = LocalToastType.Error
          break
        case 'warning':
        case 'info':
        default:
          localType = LocalToastType.Normal
          break
      }
    }

    Toast.showToast({
      text: options.text,
      type: localType
    })
  }

  showCursorToast(options: { text: string; trackDom: HTMLElement }): void {
    CursorToast.showToast({
      text: options.text,
      trackDom: options.trackDom
    })
  }
}
