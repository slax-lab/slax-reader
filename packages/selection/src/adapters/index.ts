/**
 * 适配器接口统一导出
 *
 * 这些接口定义了Selection模块对外部环境的依赖，
 * 不同环境（dweb/extensions）需要实现这些接口来适配各自的实现
 */

export * from './IUserProvider'
export * from './IHttpClient'
export * from './IToastService'
export * from './II18nService'
export * from './IEnvironmentAdapter'
export * from './IBookmarkProvider'

import type { IUserProvider } from './IUserProvider'
import type { IHttpClient } from './IHttpClient'
import type { IToastService } from './IToastService'
import type { II18nService } from './II18nService'
import type { IEnvironmentAdapter } from './IEnvironmentAdapter'
import type { IBookmarkProvider } from './IBookmarkProvider'
import type { Ref } from 'vue'
import type { MarkType as BackendMarkType } from '@commons/types/interface'

/**
 * Selection模块依赖集合
 *
 * 包含所有必需的适配器接口实例
 */
export interface SelectionDependencies {
  /** 用户信息提供者 */
  userProvider: IUserProvider
  /** HTTP客户端 */
  httpClient: IHttpClient
  /** Toast提示服务 */
  toastService: IToastService
  /** 国际化服务 */
  i18nService: II18nService
  /** 环境适配器 */
  environmentAdapter: IEnvironmentAdapter
  /** 书签信息提供者 */
  bookmarkProvider: IBookmarkProvider
  /** 用于创建响应式引用的工厂函数（必需，必须使用 Vue 的 ref） */
  refFactory: <T>(value: T) => Ref<T>
  /** 获取标记类型的函数（必需，不同环境有不同实现） */
  getMarkType: (type: 'comment' | 'reply' | 'line') => BackendMarkType
}
