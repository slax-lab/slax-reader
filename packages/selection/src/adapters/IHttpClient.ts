import type { FetchOptions } from '@commons/utils/request'

/**
 * HTTP客户端适配器接口
 *
 * 用于统一dweb和extensions的HTTP请求方式
 * - dweb: 使用request()组合式函数
 * - extensions: 使用全局request实例
 *
 * 注意: request函数内部已经处理了FetchResult,并返回data字段
 * 所以这里的返回类型是T | undefined,而不是FetchResult<T>
 * undefined表示请求失败或被拦截器处理
 */
export interface IHttpClient {
  /**
   * 发起POST请求
   * @param options 请求选项
   * @returns 响应数据(类型为T),如果请求失败则返回undefined
   */
  post<T = unknown>(options: FetchOptions): Promise<T | undefined>

  /**
   * 发起GET请求
   * @param options 请求选项
   * @returns 响应数据(类型为T),如果请求失败则返回undefined
   */
  get<T = unknown>(options: FetchOptions): Promise<T | undefined>

  /**
   * 发起PUT请求
   * @param options 请求选项
   * @returns 响应数据(类型为T),如果请求失败则返回undefined
   */
  put<T = unknown>(options: FetchOptions): Promise<T | undefined>

  /**
   * 发起DELETE请求
   * @param options 请求选项
   * @returns 响应数据(类型为T),如果请求失败则返回undefined
   */
  delete<T = unknown>(options: FetchOptions): Promise<T | undefined>
}
