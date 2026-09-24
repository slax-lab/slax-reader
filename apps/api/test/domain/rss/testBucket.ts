import { vi } from 'vitest'
export function memoryRssBucket() {
  const objects = new Map<string, { body: string; uploaded: Date }>()
  const r2 = {
    put: vi.fn(async (key: string, body: string) => {
      objects.set(key, { body, uploaded: new Date() })
      return { key }
    }),
    get: vi.fn(async (key: string) => {
      const item = objects.get(key)
      return item ? { ...item, text: async () => item.body } : null
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) objects.delete(key)
    }),
    list: vi.fn(async ({ prefix, limit, cursor }: { prefix: string; limit: number; cursor?: string }) => {
      const keys = [...objects.keys()].filter(key => key.startsWith(prefix) && (!cursor || key > cursor)).sort()
      return { objects: keys.slice(0, limit).map(key => ({ key, uploaded: objects.get(key)!.uploaded })), truncated: keys.length > limit, cursor: keys[limit - 1] }
    })
  }
  const client = { R2Bucket: r2, putIfKeyExists: vi.fn(async (key: string, body: string) => r2.put(key, body)) }
  return { objects, r2, client }
}
