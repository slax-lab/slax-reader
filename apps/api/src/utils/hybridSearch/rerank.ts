export interface SearchResponse {
  model: string
  usage: {
    total_tokens: number
  }
  results: SearchResult[]
}

export interface SearchResult {
  index: number
  document: {
    text: string
  }
  relevance_score: number
}

const rerankerURL = 'https://api.jina.ai/v1/rerank'
const rerankerModel = 'jina-reranker-v2-base-multilingual'

export async function rerank(env: Env, keyword: string, texts: string[]) {
  const requestData = {
    model: rerankerModel,
    query: keyword,
    top_n: 10,
    documents: texts
  }

  const resp = (await fetch(rerankerURL, {
    method: 'POST',
    body: JSON.stringify(requestData),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.JINA_API_KEY}`
    }
  })) as Response
  if (!resp.ok) {
    console.error(`rerank failed: ${await resp.text()}`)
    return []
  }

  const response = (await resp.json()) as SearchResponse
  return response.results.map(item => ({
    text: item.document.text,
    score: item.relevance_score,
    index: item.index
  }))
}
