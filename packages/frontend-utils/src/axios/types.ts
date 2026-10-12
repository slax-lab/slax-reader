/* eslint-disable @typescript-eslint/no-explicit-any */
import type { InternalAxiosRequestConfig, AxiosResponse } from 'axios'

export interface CreateAxiosOptions extends InternalAxiosRequestConfig {
  transform?: AxiosTransform
  requestOptions?: RequestOptions
}

export abstract class AxiosTransform {
  /**
   * @description: 请求前处理器
   */
  beforeRequestHook?: (config: InternalAxiosRequestConfig, options: RequestOptions) => InternalAxiosRequestConfig

  /**
   * @description: 请求成功处理器
   */
  transformRequestHook?: <T = unknown>(res: AxiosResponse<Result>, options: RequestOptions) => T

  /**
   * @description: 请求失败处理器
   */
  requestCatchHook?: (error: Error, options: RequestOptions) => Promise<any>

  /**
   * @description: 请求前拦截器
   */
  requestInterceptors?: (config: InternalAxiosRequestConfig, options: CreateAxiosOptions) => InternalAxiosRequestConfig

  /**
   * @description: 请求后拦截器
   */
  responseInterceptors?: (response: AxiosResponse<any>) => AxiosResponse<any>

  /**
   * @description: 请求前错误处理处理器
   */
  requestInterceptorsCatch?: (error: Error) => void

  /**
   * @description: 请求后错误处理处理器
   */
  responseInterceptorsCatch?: (error: Error) => void
}

export interface RequestOptions {
  isReturnNativeResponse?: boolean
  joinPrefix?: boolean
  apiUrl?: string
  urlPrefix?: string
  ignoreCancelToken?: boolean
}

export interface Result<T = any> {
  retcode: string
  retmsg: string
  retdata: T
}
