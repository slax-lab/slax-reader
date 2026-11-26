export const publicReaderCache = 'slax-public-reader-v1'
export const readerPath = /^\/(b|s)\/([a-zA-Z0-9_-]+)\/?$/
export const denied = (status: number) => [401, 403, 404, 410].includes(status)

export type OfflineArticle = {
  title: string
  text: string
}

export type ReaderAppearance = {
  locale: 'zh' | 'en'
  theme: 'light' | 'dark' | 'eink'
}

export const appearancePath = '/__offline-reader/appearance'

export async function evictPublicReader(cache: Cache, path: string) {
  if (path.startsWith('/s/')) {
    const alias = await cache.match(path)
    if (alias) await cache.delete(await alias.json())
  }
  await cache.delete(path)
}
