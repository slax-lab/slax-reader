import { describe, test, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BucketClient } from '@/infra/repository/bucketClient'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('consolidated backend', () => {
  test('has no public-source inheritance layer or imports', () => {
    for (const path of sourceFiles(join(import.meta.dirname, '../src'))) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/\bextends\s+Public[A-Z]|@public\//)
      expect(path).not.toMatch(/\.base\.ts$/)
    }
  })

  test('BucketClient owns its methods and retains R2 behavior', async () => {
    const object = { key: 'article' }
    const bucket = {
      put: vi.fn().mockResolvedValue(object),
      get: vi.fn().mockResolvedValue(object),
      delete: vi.fn().mockResolvedValue(undefined)
    }
    const client = new BucketClient({ OSS: bucket, RUN_ENV: 'dev' } as unknown as Env)
    expect(Object.getPrototypeOf(BucketClient.prototype)).toBe(Object.prototype)
    expect(Object.hasOwn(BucketClient.prototype, 'putIfKeyExists')).toBe(true)
    expect(await client.putIfKeyExists()).toBeNull()
    expect(bucket.put).not.toHaveBeenCalled()
    expect(await client.putIfKeyExists('article', 'body')).toBe(object)
    expect(bucket.put).toHaveBeenCalledWith('article', 'body')
    expect(await client.getIfKeyExists('article')).toBe(object)
    await client.deleteIfKeyExists('article')
    expect(bucket.delete).toHaveBeenCalledWith('article')
    expect(await client.putRemoteIfKeyExists('https://example.test/image', 'images')).toBeNull()
  })
})
