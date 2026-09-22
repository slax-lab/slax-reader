import { describe, expect, test } from 'vitest'

import { ContextManager } from '@/utils/context'

import { parseClientSource, resolvePlatform } from '@/utils/clientPlatform'

// 埋点 platform 判定：自报头优先，其次 UA
// 取值须落在 dbLogs 统计的 web/ios/android/extension 之内

const req = (headers: Record<string, string>) => new Request('https://api.local/v1/collection/subscribe', { headers })

describe('parseClientSource', () => {
  test('识别 SlaxReader 客户端 UA 及版本', () => {
    expect(parseClientSource('SlaxReader/iOS 1.2.3')).toEqual({ platform: 'ios', version: '1.2.3' })
    expect(parseClientSource('SlaxReader/Android 2.0.0-beta')).toEqual({ platform: 'android', version: '2.0.0-beta' })
  })

  test('大小写不敏感', () => {
    expect(parseClientSource('slaxreader/ios 1.0').platform).toBe('ios')
  })

  test('浏览器 UA 与空 UA 都落 web', () => {
    expect(parseClientSource('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0').platform).toBe('web')
    expect(parseClientSource('')).toEqual({ platform: 'web' })
  })

  // 前缀不匹配就不算客户端，避免被伪造 UA 混入 ios 维度
  test('SlaxReader 不在开头则不算客户端', () => {
    expect(parseClientSource('Mozilla/5.0 SlaxReader/iOS 1.2.3').platform).toBe('web')
  })
})

describe('resolvePlatform', () => {
  test('X-CLIENT-TYPE 命中白名单时优先采用', () => {
    expect(resolvePlatform(req({ 'X-CLIENT-TYPE': 'extension' }))).toBe('extension')
    expect(resolvePlatform(req({ 'x-client-type': 'IOS' }))).toBe('ios')
  })

  // 扩展只有自报头这一条路，UA 是普通浏览器
  test('自报 extension 时不被 UA 覆盖', () => {
    expect(resolvePlatform(req({ 'X-CLIENT-TYPE': 'extension', 'User-Agent': 'Mozilla/5.0 Chrome/128.0.0.0' }))).toBe('extension')
  })

  test('自报值非白名单则回落 UA', () => {
    expect(resolvePlatform(req({ 'X-CLIENT-TYPE': 'hacked', 'User-Agent': 'SlaxReader/Android 1.0' }))).toBe('android')
    expect(resolvePlatform(req({ 'X-CLIENT-TYPE': '' }))).toBe('web')
  })

  test('无任何头时落 web', () => {
    expect(resolvePlatform(req({}))).toBe('web')
  })
})

// platform 由 requestLog 写进 ctx.getPlatform()，下游埋点直接读该字段
describe('ctx.getPlatform()', () => {
  const ctx = () => new ContextManager({} as ExecutionContext, {} as Env)

  test('赋值后可读出，口径与 resolvePlatform 一致', () => {
    const c = ctx()
    c.setPlatform(resolvePlatform(req({ 'User-Agent': 'SlaxReader/iOS 1.2.3' })))
    expect(c.getPlatform()).toBe('ios')

    const c2 = ctx()
    c2.setPlatform(resolvePlatform(req({ 'X-CLIENT-TYPE': 'extension', 'User-Agent': 'Mozilla/5.0 Chrome/128.0.0.0' })))
    expect(c2.getPlatform()).toBe('extension')
  })

})
