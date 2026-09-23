import type { SelectionConfig } from '../types'
import type { IEnvironmentAdapter } from '../adapters'

/**
 * Base基类
 *
 * 提供环境访问的基础能力，通过环境适配器统一访问window和document
 */
export class Base {
  protected environmentAdapter: IEnvironmentAdapter

  constructor(
    protected _config: SelectionConfig,
    environmentAdapter: IEnvironmentAdapter
  ) {
    this.environmentAdapter = environmentAdapter
  }

  /**
   * 获取目标window对象
   */
  protected get window(): Window {
    return this.environmentAdapter.getWindow()
  }

  /**
   * 获取目标document对象
   */
  protected get document(): Document {
    return this.environmentAdapter.getDocument()
  }

  /**
   * 获取Selection对象
   */
  protected getSelection(): Selection | null {
    return this.environmentAdapter.getSelection()
  }

  /**
   * 获取配置对象
   */
  protected get config(): SelectionConfig {
    return this._config
  }
}
