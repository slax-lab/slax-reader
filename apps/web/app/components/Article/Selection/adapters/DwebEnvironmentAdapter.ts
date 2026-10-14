import type { IEnvironmentAdapter } from '@slax-reader/selection/adapters'

/**
 * Dweb端环境适配器
 *
 * 支持iframe模式，访问iframe的contentWindow和contentDocument
 */
export class DwebEnvironmentAdapter implements IEnvironmentAdapter {
  private iframe?: HTMLIFrameElement

  constructor(iframe?: HTMLIFrameElement) {
    this.iframe = iframe
  }

  getWindow(): Window {
    return this.iframe ? this.iframe.contentWindow! : window
  }

  getDocument(): Document {
    return this.iframe ? this.iframe.contentDocument! : document
  }

  getSelection(): Selection | null {
    const win = this.getWindow()
    return win.getSelection()
  }
}
