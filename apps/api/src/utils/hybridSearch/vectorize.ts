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
const embeddingTimeoutMs = 800

export async function embedding(env: Env, content: string[]): Promise<vectorizeData[]> {
  if (content.length < 1 || !env.JINA_API_KEY) return []

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
      console.log(`vectorize failed: ${await resp.text()}`)
      return []
    }
    return ((await resp.json()) as vectorizeResult).data
  } catch (e) {
    console.log(`vectorize failed: ${e instanceof Error ? e.message : String(e)}`)
    return []
  } finally {
    clearTimeout(timeout)
  }
}
