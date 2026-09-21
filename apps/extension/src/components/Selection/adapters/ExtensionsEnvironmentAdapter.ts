import type { IEnvironmentAdapter } from '@slax-reader/selection/adapters'

/**
 * Extensions端环境适配器
 *
 * 直接访问当前页面的window和document
 */
export class ExtensionsEnvironmentAdapter implements IEnvironmentAdapter {
  getWindow(): Window {
    return window
  }

  getDocument(): Document {
    return document
  }

  getSelection(): Selection | null {
    return window.getSelection()
  }
}
