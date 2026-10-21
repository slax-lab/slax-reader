export interface vectorizeResult {
  model: string
  object: string
  usage: vectorizeUsage
  data: vectorizeData[]
}

export interface vectorizeUsage {
  total_tokens: number
  prompt_tokens: number
}

export interface vectorizeData {
  object: string
  index: number
  embedding: number[]
}

const vectorizerURL = 'https://api.jina.ai/v1/embeddings'
const vectorizerModel = 'jina-clip-v2'
const embeddingCachePrefix = 'search:emb:v1:jina-clip-v2:1024:'
const embeddingCacheTtl = 604800
const embeddingTimeoutMs = 800

const hashText = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const writeCache = (env: Env, execution: ExecutionContext | undefined, key: string, embedding: number[]): void => {
  const write = Promise.resolve(env.KV.put(key, JSON.stringify(embedding), { expirationTtl: embeddingCacheTtl }))
  if (execution?.waitUntil) {
    execution.waitUntil(write)
    return
  }
  void write.catch(() => {})
}

export async function embedding(env: Env, content: string[], execution?: ExecutionContext): Promise<vectorizeData[]> {
  if (content.length < 1) return []

  const cacheable = !!execution && content.length <= 4 && !!env.KV
  const cached: Array<vectorizeData | null> = content.map(() => null)
  const missing: Array<{ index: number; text: string }> = []
  let cacheKeys: string[] = []

  if (cacheable) {
    cacheKeys = await Promise.all(content.map(text => hashText(text)))
    const values = await Promise.all(cacheKeys.map(key => env.KV.get(embeddingCachePrefix + key).catch(() => null)))
    content.forEach((text, index) => {
      if (!values[index]) {
        missing.push({ index, text })
        return
      }
      try {
        cached[index] = { object: 'embedding', index, embedding: JSON.parse(values[index]) as number[] }
      } catch {
        missing.push({ index, text })
      }
    })
  } else {
    content.forEach((text, index) => missing.push({ index, text }))
  }

  if (missing.length < 1) return cached.filter((item): item is vectorizeData => !!item)
  if (!env.JINA_API_KEY) return cached.filter((item): item is vectorizeData => !!item)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), embeddingTimeoutMs)

  try {
    const resp = (await fetch(vectorizerURL, {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({
        model: vectorizerModel,
        dimensions: 1024,
        // 归一化
        normalized: true,
        embedding_type: 'float',
        input: missing.map(item => {
          return { text: item.text }
        })
      }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.JINA_API_KEY}`
      }
    })) as Response
    if (!resp.ok) {
      console.log(`vectorize failed: ${await resp.text()}`)
      return cached.filter((item): item is vectorizeData => !!item)
    }

    const data = ((await resp.json()) as vectorizeResult).data
    const fresh = data.map(item => {
      const index = missing[item.index]?.index ?? item.index
      return { object: 'embedding', index, embedding: item.embedding }
    })

    if (cacheable) {
      for (const item of fresh) {
        const key = cacheKeys[item.index]
        if (key) writeCache(env, execution, embeddingCachePrefix + key, item.embedding)
      }
    }

    const merged = new Map<number, vectorizeData>()
    for (const item of cached) {
      if (item) merged.set(item.index, item)
    }
    for (const item of fresh) merged.set(item.index, item)
    return [...merged.values()].sort((a, b) => a.index - b.index)
  } catch (e) {
    console.log(`vectorize failed: ${e instanceof Error ? e.message : String(e)}`)
    return cached.filter((item): item is vectorizeData => !!item)
  } finally {
    clearTimeout(timeout)
  }
}
