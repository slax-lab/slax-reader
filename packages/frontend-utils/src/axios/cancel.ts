import type { AxiosRequestConfig, Canceler } from 'axios'
import axios from 'axios'
import { isFunction } from './../is'

let pendingMap = new Map<string, Canceler>()

export const getPendingUrl = (config: AxiosRequestConfig) => [config.method, config.url].join('&')

export class AxiosCanceler {
  /**
   * 增加请求加入队列
   * @param {Object} config
   */
  addPending(config: AxiosRequestConfig) {
    this.removePending(config)
    const url = getPendingUrl(config)
    config.cancelToken =
      config.cancelToken ||
      new axios.CancelToken(cancel => {
        if (!pendingMap.has(url)) {
          pendingMap.set(url, cancel)
        }
      })
  }

  /**
   * @description: 清除队列中所有请求
   */
  removeAllPending() {
    pendingMap.forEach(cancel => {
      cancel && isFunction(cancel) && cancel()
    })
    pendingMap.clear()
  }

  /**
   * 从队列中删除对应请求
   * @param {Object} config
   */
  removePending(config: AxiosRequestConfig) {
    const url = getPendingUrl(config)

    if (pendingMap.has(url)) {
      const cancel = pendingMap.get(url)
      cancel && cancel(url)
      pendingMap.delete(url)
    }
  }

  /**
   * @description: 重置队列
   */
  reset(): void {
    pendingMap = new Map<string, Canceler>()
  }
}
