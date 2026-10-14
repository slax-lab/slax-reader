import Toast from '../../Toast'
import { ToastType as LocalToastType } from '../../Toast/type'
import type { IToastService, ToastType } from '@slax-reader/selection/adapters'

/**
 * Extensions端Toast服务
 *
 * 使用全局Toast组件
 */
export class ExtensionsToastService implements IToastService {
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

  // Extensions不支持CursorToast
  showCursorToast = undefined
}
