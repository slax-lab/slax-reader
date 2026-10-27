import { expect, test, vi } from 'vitest'
import { YoutubeArticleRepo } from '@/infra/repository/dbYoutubeArticle'

test('a prompt upgrade preserves old articles and prefers the current language version', async () => {
  const old = { id: 1, target_language: 'en', prompt_version: 'v1', status: 'ready' }
  const current = { id: 2, target_language: 'zh', prompt_version: 'v2', status: 'pending' }
  const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(old)
  const findMany = vi
    .fn()
    .mockResolvedValueOnce([current])
    .mockResolvedValueOnce([old, { ...old, target_language: 'zh' }])
  const repo = new YoutubeArticleRepo(() => ({ sr_media_article: { findUnique, findMany } }) as any)
  expect(await repo.findVersion('video', 'hash', 'en')).toBe(old)
  expect(findUnique).toHaveBeenCalledTimes(2)
  expect(await repo.listForSource('video', 'hash')).toEqual([current, old])
})
