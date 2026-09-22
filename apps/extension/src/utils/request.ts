import { isClient } from '@commons/frontend-utils/is'
import { FetchRequest, type FetchResult } from '@commons/frontend-utils/request'

import { LocalStorageKey } from '@commons/types/const'
import { NOT_LOGIN_ERROR } from '@commons/types/error'
import { storage } from '@wxt-dev/storage'

// 命名为 plainRequest（而非 request）：避免与 bridge/request.ts 导出的全局自动导入 `request`
// 撞名——wxt 的 imports.dirs 会扫描本目录，同名导出会与 wxt.config.ts 里显式指定的
// `{ name: 'request', from: bridge/request.ts }` 产生冲突，覆盖掉书签桥感知的版本。
// 本文件是不带书签桥 URL 参数替换的原始请求客户端，仅供不涉及书签详情的场景显式引用。
export const plainRequest = new FetchRequest({
  baseUrl: `${process.env.EXTENSIONS_API_BASE_URL}`,
  requestInterceptors: async options => {
    const token = await storage.getItem<string>(`${LocalStorageKey.USER_TOKEN}`)
    if (!token) {
      return options
    }
    options.headers = {
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {})
    }
    return options
  },
  responseInterceptors: async <T = unknown>(response: FetchResult<unknown>) => {
    if (response.status === 401) {
      await storage.removeItem(LocalStorageKey.USER_TOKEN)
      const url = `${process.env.PUBLIC_BASE_URL}/login?from=extension`
      if (isClient) {
        window?.open(url)
      } else if (browser && browser.tabs) {
        browser.tabs.create({ url })
      }

      throw NOT_LOGIN_ERROR
    }

    return response as FetchResult<T>
  },
  errorInterceptors: error => {
    console.log(error)
  }
})
