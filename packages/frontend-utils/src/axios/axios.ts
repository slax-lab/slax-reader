import type { CreateAxiosOptions, RequestOptions, Result } from './types'
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, CreateAxiosDefaults } from 'axios'
import axios from 'axios'
import { cloneDeep } from 'lodash-es'
import { isFunction } from '../is'
import { AxiosCanceler } from './cancel'

export class VAxios {
  private axiosInstance: AxiosInstance
  private readonly options: CreateAxiosOptions

  constructor(options: CreateAxiosOptions) {
    this.options = options
    this.axiosInstance = axios.create(options)
    this.setupInterceptors()
  }

  getAxios(): AxiosInstance {
    return this.axiosInstance
  }

  configAxios(config: CreateAxiosOptions) {
    if (!this.axiosInstance) {
      return
    }

    this.createAxios(config)
  }

  setHeaders(headers: Record<string, string>): void {
    if (!this.axiosInstance) {
      return
    }

    Object.assign(this.axiosInstance.defaults.headers, headers)
  }

  request<T = unknown>(config: InternalAxiosRequestConfig, options?: RequestOptions): Promise<T> {
    let requestConfig: CreateAxiosOptions = cloneDeep(config)
    const requestOptions: RequestOptions = Object.assign({}, this.options.requestOptions, options)

    const { beforeRequestHook, requestCatchHook, transformRequestHook } = this.getTransform() || {}
    if (beforeRequestHook && isFunction(beforeRequestHook)) {
      requestConfig = beforeRequestHook(requestConfig, requestOptions)
    }

    requestConfig.requestOptions = requestOptions

    return new Promise((resolve, reject) => {
      this.axiosInstance
        .request<unknown, AxiosResponse<Result>>(requestConfig)
        .then((res: AxiosResponse<Result>) => {
          if (transformRequestHook && isFunction(transformRequestHook)) {
            try {
              const ret = transformRequestHook(res, requestOptions)
              resolve(ret as T)
            } catch (error) {
              reject(error || new Error('request error'))
            }

            return
          }

          resolve(res as T)
        })
        .catch((error: Error | AxiosError) => {
          if (requestCatchHook && isFunction(requestCatchHook)) {
            reject(requestCatchHook(error, requestOptions))
            return
          }

          reject(error)
        })
    })
  }

  get<T = unknown>(config: InternalAxiosRequestConfig, options?: RequestOptions): Promise<T> {
    return this.request({ ...config, method: 'GET' }, options)
  }

  post<T = unknown>(config: InternalAxiosRequestConfig, options?: RequestOptions): Promise<T> {
    return this.request({ ...config, method: 'POST' }, options)
  }

  put<T = unknown>(config: InternalAxiosRequestConfig, options?: RequestOptions): Promise<T> {
    return this.request({ ...config, method: 'PUT' }, options)
  }

  delete<T = unknown>(config: InternalAxiosRequestConfig, options?: RequestOptions): Promise<T> {
    return this.request({ ...config, method: 'DELETE' }, options)
  }

  private createAxios(config: CreateAxiosDefaults): void {
    this.axiosInstance = axios.create(config)
  }

  private setupInterceptors() {
    const transform = this.getTransform()
    if (!transform) {
      return
    }

    const axiosCanceler = new AxiosCanceler()

    // 处理请求和返回体配置
    this.axiosInstance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const {
        headers: { ignoreCancelToken }
      } = config

      const ignoreCancel = ignoreCancelToken !== undefined ? ignoreCancelToken : this.options.requestOptions?.ignoreCancelToken

      !ignoreCancel && axiosCanceler.addPending(config)
      if (requestInterceptors && isFunction(requestInterceptors)) {
        config = requestInterceptors(config, this.options)
      }

      return config
    }, undefined)

    this.axiosInstance.interceptors.response.use((res: AxiosResponse<unknown>) => {
      res && axiosCanceler.removePending(res.config)
      if (responseInterceptors && isFunction(responseInterceptors)) {
        res = responseInterceptors(res)
      }

      return res
    }, undefined)

    // 处理拦截器
    const { requestInterceptors, requestInterceptorsCatch, responseInterceptors, responseInterceptorsCatch } = transform

    // 目前仅加上了错误拦截处理器，还没加请求和返回拦截处理器
    requestInterceptorsCatch && isFunction(requestInterceptorsCatch) && this.axiosInstance.interceptors.request.use(undefined, requestInterceptorsCatch)
    responseInterceptorsCatch && isFunction(responseInterceptorsCatch) && this.axiosInstance.interceptors.response.use(undefined, responseInterceptorsCatch)
  }

  private getTransform() {
    const { transform } = this.options
    return transform
  }
}
