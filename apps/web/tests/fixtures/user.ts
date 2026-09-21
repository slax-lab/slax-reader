// 用户 fixture：useAuth.spec.ts 等用例的 baseUser + tokenString
// 字段以 commons/types/src/interface.ts 的 UserInfo 接口为准
import type { UserInfo } from '@commons/types/interface'

// 基础对象：字段按 UserInfo 真实接口填，必填字段全填上中性默认值
export const baseUser: UserInfo = {
  userId: 1,
  email: 'test@example.com',
  lang: 'en',
  name: 'Test User',
  picture: 'https://example.com/avatar.jpg',
  timezone: 'UTC'
}

export const makeUser = (overrides: Partial<UserInfo> = {}): UserInfo => ({
  ...baseUser,
  ...overrides
})

export const tokenString = 'test-token-abc123'
