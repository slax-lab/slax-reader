import { describe, expect, it } from 'vitest'
import { AxiosCanceler, AxiosTransform, VAxios, getPendingUrl } from '@commons/frontend-utils/axios'
import type { CreateAxiosOptions, RequestOptions, Result } from '@commons/frontend-utils/axios'

describe('frontend-utils public Axios subpath', () => {
  it('supports a consumer request without a live backend', async () => {
    const payload: Result<string> = { retcode: '0', retmsg: 'ok', retdata: 'fixture' }
    const options: CreateAxiosOptions = {
      headers: {} as CreateAxiosOptions['headers'],
      adapter: async config => ({ data: payload, status: 200, statusText: 'OK', headers: {}, config })
    }
    const requestOptions: RequestOptions = { ignoreCancelToken: true }
    const client = new VAxios(options)
    const response = await client.get<{ data: Result<string> }>({ url: '/fixture', headers: options.headers }, requestOptions)
    expect(response.data).toEqual(payload)
  })

  it('exports the existing transform and cancellation helpers', () => {
    expect(AxiosTransform).toBeTypeOf('function')
    const canceler = new AxiosCanceler()
    const config: CreateAxiosOptions = { url: '/fixture', method: 'get', headers: {} as CreateAxiosOptions['headers'] }
    try {
      canceler.addPending(config)
      expect(config.cancelToken?.reason).toBeUndefined()
      canceler.removePending(config)
      expect(config.cancelToken?.reason?.message).toBe(getPendingUrl(config))
    } finally {
      canceler.removeAllPending()
    }
  })
})
