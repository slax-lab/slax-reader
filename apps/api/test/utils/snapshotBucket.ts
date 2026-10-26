export function memoryBucket() {
  const objects = new Map<string, { value: string; etag: string; customMetadata?: Record<string, string> }>()
  let revision = 0
  const bucket = {
    async head(key: string) {
      const object = objects.get(key)
      return object ? { ...object, key } : null
    },
    async get(key: string, options?: { onlyIf?: { etagMatches?: string } }) {
      const object = objects.get(key)
      if (!object) return null
      if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== object.etag) return { key, etag: object.etag }
      return { ...object, key, body: new Response(object.value).body, text: async () => object.value, json: async () => JSON.parse(object.value) }
    },
    async put(key: string, body: any, options?: any) {
      const value = typeof body === 'string' ? body : await new Response(body).text()
      const result = { value, etag: String(++revision), customMetadata: options?.customMetadata }
      objects.set(key, result)
      return { ...result, key }
    },
    async delete(keys: string | string[]) {
      for (const key of [keys].flat()) objects.delete(key)
    }
  }
  return { bucket: bucket as unknown as R2Bucket, objects }
}
