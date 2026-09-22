import { afterEach, describe, expect, test, vi } from 'vitest'
import { UserService } from '@/domain/user'
import { RedisClient } from '@/infra/repository/redisClient'
import { TwitterOAuth2 } from '@/utils/auth/authTwitter'

afterEach(() => vi.restoreAllMocks())

describe('Twitter OAuth binding', () => {
  test.each(['a'.repeat(16) + '.' + 'b'.repeat(15), 'a'.repeat(16) + '~' + 'b'.repeat(15)])('accepts generated RFC7636 state characters and consumes once: %s', async state => {
    let remaining = true
    const consume = vi.fn(async () => {
      if (!remaining) return null
      remaining = false
      return { userId: 1, codeVerifier: 'verifier', createdAt: Date.now() }
    })
    vi.spyOn(RedisClient.prototype, 'twitterOAuthState').mockReturnValue({ consume, delete: vi.fn().mockResolvedValue(undefined) } as never)
    const exchange = vi.spyOn(TwitterOAuth2.prototype, 'handleCallback').mockResolvedValue({ accessToken: 'token' } as never)
    vi.spyOn(TwitterOAuth2.prototype, 'getUser').mockResolvedValue({ id: 'twitter-user', username: 'user' } as never)
    const repo = { requireActiveUser: vi.fn().mockResolvedValue(undefined), getUserByPlatform: vi.fn().mockResolvedValue(null), userBindPlatform: vi.fn().mockResolvedValue(null) }
    const service = Object.assign(Object.create(UserService.prototype), { userRepoData: repo }) as UserService
    const ctx = { env: { UPSTASH_REDIS_REST_URL: 'https://redis.example', UPSTASH_REDIS_REST_TOKEN: 'test' } } as never
    const results = await Promise.allSettled([service.handleOAuth2Bind(ctx, 'twitter', state, 'code'), service.handleOAuth2Bind(ctx, 'twitter', state, 'code')])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(exchange).toHaveBeenCalledOnce()
    expect(repo.userBindPlatform).toHaveBeenCalledOnce()
    expect(repo.requireActiveUser).toHaveBeenCalledTimes(2)
  })
})
