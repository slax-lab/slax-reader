import { DurableObject } from 'cloudflare:workers'
import { cut_for_search, initSync } from '../wasmJieba/jieba_rs_wasm.js'
import { RequestUtils } from '../requestUtils'
import { Failed, NotFound, Successed } from '../responseUtils'

// jieba splits text into runs of Han characters, letters, digits and `+#&._%-`, and cuts each run on its own. Ending a
// chunk after any other character (except `\r`, which pairs with `\n`, and surrogate halves) keeps the output identical
// to one call on the whole text, while bounding the memory a single call needs.
const CHUNK_LENGTH = 32 * 1024
const RUN_OR_PAIR = /[\r\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uD800-\uDFFFa-zA-Z0-9+#&._%-]/

// One WebAssembly instance per isolate, so Durable Objects sharing the isolate share its dictionary memory.
let jiebaReady: Promise<void> | undefined

function loadJieba(): Promise<void> {
  jiebaReady ??= import('../wasmJieba/jieba_rs_wasm_bg.wasm').then(
    ({ default: module }) => {
      initSync({ module })
    },
    error => {
      jiebaReady = undefined
      throw error
    }
  )
  return jiebaReady
}

function chunkEnd(text: string, start: number): number {
  if (text.length - start <= CHUNK_LENGTH) return text.length
  let end = start + CHUNK_LENGTH
  while (end > start && RUN_OR_PAIR.test(text[end - 1])) end--
  if (end > start) return end
  end = start + CHUNK_LENGTH
  while (end < text.length && RUN_OR_PAIR.test(text[end - 1])) end++
  return end
}

// Long documents are cut one at a time: each keeps its token list until it is answered, about 25 MB of JS heap per 2 MB.
let documentQueue: Promise<unknown> = Promise.resolve()

async function cutDocument(text: string, hmm?: boolean): Promise<string[]> {
  const words: string[] = []
  for (let start = 0; start < text.length; ) {
    // Let search queries run between the chunks of a long document.
    if (start > 0) await new Promise(resolve => setTimeout(resolve, 0))
    const end = chunkEnd(text, start)
    for (const word of cut_for_search(text.slice(start, end), hmm)) words.push(word)
    start = end
  }
  return words
}

async function cutForSearch(text: string, hmm?: boolean): Promise<string[]> {
  await loadJieba()
  if (text.length <= CHUNK_LENGTH) return cut_for_search(text, hmm)
  const words = documentQueue.then(() => cutDocument(text, hmm))
  documentQueue = words.catch(() => undefined)
  return words
}

export class SlaxJieba extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const { text, hmm } = await RequestUtils.json<{ text: string; hmm?: boolean }>(request)

    if (!text) return new Response('Text is required', { status: 400 })
    if (url.hostname !== 'cut_for_search') return NotFound('Not found')

    try {
      return Successed(await cutForSearch(text, hmm))
    } catch (error) {
      console.error('Error processing request:', error)
      return Failed(error instanceof Error ? error.message : 'Internal server error')
    }
  }
}
