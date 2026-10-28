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

export async function embedding(env: Env, content: string[], options: { strictPrivate?: boolean } = {}): Promise<vectorizeData[]> {
  if (content.length < 1) return []
  if (!env.JINA_API_KEY) {
    if (options.strictPrivate) throw new Error('Private embeddings unavailable')
    return []
  }
  const resp = (await fetch(vectorizerURL, {
    method: 'POST',
    body: JSON.stringify({
      model: vectorizerModel,
      dimensions: 1024,
      // 归一化
      normalized: true,
      embedding_type: 'float',
      input: content.map(item => {
        return { text: item }
      })
    }),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.JINA_API_KEY}`
    }
  })) as Response
  if (!resp.ok) {
    if (options.strictPrivate) throw new Error('Private embeddings unavailable')
    console.log(`vectorize failed: ${await resp.text()}`)
    return []
  }
  const data = ((await resp.json()) as vectorizeResult).data
  if (
    options.strictPrivate &&
    (!Array.isArray(data) ||
      data.length !== content.length ||
      data.some(row => !Array.isArray(row.embedding) || !row.embedding.length || row.embedding.some(value => !Number.isFinite(value))))
  )
    throw new Error('Private embeddings unavailable')
  return data
}
