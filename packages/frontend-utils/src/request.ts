import { isFunction, isPromise } from './is'

export class RequestError extends Error {
  override name: string
  code: number

  constructor(params: { message: string; name: string; code: number }) {
    super(params.message)
    this.name = params.name
    this.code = params.code
  }
}

export enum RequestMethodType {
  get = 'get',
  post = 'post',
  put = 'put',
  delete = 'delete'
}

// fetch请求配置
interface FetchConfig {
  baseUrl: string | (() => string)
  requestInterceptors?: (options: FetchOptions) => FetchOptions | Promise<FetchOptions>
  responseInterceptors?: <T = unknown>(response: FetchResult<unknown>) => FetchResult<T> | Promise<FetchResult<T>>
  errorInterceptors?: (error: unknown) => unknown
}

type StreamCallbackFunc = (handler: (text: string, done: boolean) => void) => Promise<void>

// fetch请求参数
export type FetchOptions = {
  url: string
  method?: RequestMethodType
  query?: Record<string, number | string>
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  stream?: boolean
} & Pick<FetchConfig, 'errorInterceptors'>

// fetch结果
export interface FetchResult<T> {
  data: T
  status: number
  message: string
}

export class FetchRequest {
  options: FetchConfig

  constructor(options: FetchConfig) {
    this.options = options
  }

  async get<T = unknown>(options: FetchOptions) {
    return await this.handleRequest<T, FetchOptions>({
      ...options,
      method: RequestMethodType.get
    })
  }

  async post<T = unknown>(options: FetchOptions) {
    return await this.handleRequest<T, FetchOptions>({
      ...options,
      method: RequestMethodType.post
    })
  }

  async put<T = unknown>(options: FetchOptions) {
    return await this.handleRequest<T, FetchOptions>({
      ...options,
      method: RequestMethodType.put
    })
  }

  async delete<T = unknown>(options: FetchOptions) {
    return await this.handleRequest<T, FetchOptions>({
      ...options,
      method: RequestMethodType.delete
    })
  }

  async stream(options: FetchOptions) {
    return await this.handleRequest<(handler: (text: string, done: boolean) => void) => Promise<void>, FetchOptions>({
      ...options,
      stream: true
    })
  }

  async upgrade(options: FetchOptions) {
    return await fetch(options.url, {
      method: RequestMethodType.get,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket'
      }
    })
  }

  async uploadFile<T = unknown>(options: FetchOptions & { fileContent: File }) {
    return await this.handleRequest<T, FetchOptions & { fileContent: File }>({
      ...options,
      method: RequestMethodType.post,
      headers: {
        ...options.headers,
        'Content-Type': 'multipart/form-data'
      },
      body: options.fileContent
    })
  }

  async handleRequest<T, F extends FetchOptions>(options: F): Promise<(F['stream'] extends true ? StreamCallbackFunc : T) | undefined> {
    type ResultType = F['stream'] extends true ? StreamCallbackFunc : T
    try {
      const requestInterceptors = this.options.requestInterceptors
      if (requestInterceptors && isFunction(requestInterceptors)) {
        if (isPromise(requestInterceptors)) {
          options = (await requestInterceptors(options)) as F
        } else {
          options = requestInterceptors(options) as F
        }
      }

      const result = (await this.fetchRequest(options)) as Response
      if (options.stream) {
        const data = result.body
        if (!data) {
          throw new Error(`返回空数据`)
        }

        const callBack: StreamCallbackFunc = async (handler: (text: string, done: boolean) => void) => {
          const reader = data.getReader()
          const decoder = new TextDecoder('utf-8')
          let done = false
          while (!done) {
            const { value, done: readerDone } = await reader.read()
            done = readerDone
            if (value) {
              const char = decoder.decode(value, { stream: true })
              if (char) {
                handler(char, done)
              }
            }
          }

          handler('', done)
        }

        return callBack as ResultType
      }

      const response = await this.handleResult<T>(result)
      const responseInterceptors = this.options.responseInterceptors
      if (responseInterceptors && isFunction(responseInterceptors)) {
        if (isPromise(responseInterceptors)) {
          return (await responseInterceptors(response)).data as ResultType
        } else {
          return (responseInterceptors(response) as FetchResult<T>).data as ResultType
        }
      }

      return response.data as ResultType
    } catch (error) {
      if (options.errorInterceptors) {
        options.errorInterceptors(error)
      } else if (this.options.errorInterceptors) {
        this.options.errorInterceptors(error)
      }

      throw error
    }
  }

  async fetchRequest(options: FetchOptions) {
    const { url, query, body, headers, method, stream, signal } = options
    const result = await fetch(this.combineUrlWithQuery(url, query), {
      method,
      signal,
      headers: {
        'Content-Type': !stream ? 'application/json' : 'text/event-stream',
        ...headers
      },
      body: body ? (body instanceof File ? body : JSON.stringify(body)) : undefined
    })

    return result as unknown
  }

  async handleResult<T>(result: unknown) {
    const knownErrorRefs: Record<number, string> = {
      401: '请求失败，请重新登录'
    }

    if (!(result instanceof Response)) {
      throw new Error(`fetch fail: response error`)
    }

    let response: FetchResult<T> | null = null
    if (result.status !== 200) {
      if (knownErrorRefs[result.status]) {
        response = {
          data: '',
          status: result.status,
          message: knownErrorRefs[result.status]
        } as unknown as FetchResult<T>
      } else {
        const errorResult = (await result.json()) as { code: number; message: string; data: string }
        if (errorResult.message) {
          throw new RequestError({ message: errorResult.message, name: errorResult.data, code: errorResult.code })
        } else {
          throw new RequestError({ message: `fetch fail: ${errorResult ? errorResult.message : 'unknow error'}`, name: errorResult.data, code: errorResult.code })
        }
      }
    } else {
      response = (await result.json()) as FetchResult<T>
    }

    return response
  }

  combineUrlWithQuery(url: string, query?: Record<string, number | string>) {
    let baseUrl = ''
    const optionsBaseUrl = this.options.baseUrl
    if (typeof optionsBaseUrl === 'string') {
      baseUrl = optionsBaseUrl
    } else {
      baseUrl = optionsBaseUrl()
    }

    const apiUrl = `${baseUrl}${url}`

    if (!query) {
      return apiUrl
    }

    const queryStr = Object.keys(query)
      .map(key => `${key}=${query[key]}`)
      .join('&')
    return `${apiUrl}?${queryStr}`
  }
}
