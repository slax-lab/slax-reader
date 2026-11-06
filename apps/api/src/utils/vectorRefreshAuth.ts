import { createHash, timingSafeEqual } from 'node:crypto'
import { UnauthorizedError } from '@/const/err'

export function requireVectorRefreshSecret(request: Request, env: Pick<Env, 'VECTOR_REFRESH_SECRET'>): void {
  const secret = env.VECTOR_REFRESH_SECRET
  const supplied = request.headers.get('X-Vector-Refresh-Secret')
  if (!secret?.trim() || !supplied?.trim()) throw UnauthorizedError()
  const expected = createHash('sha256').update(secret).digest()
  const actual = createHash('sha256').update(supplied).digest()
  if (!timingSafeEqual(expected, actual)) throw UnauthorizedError()
}
