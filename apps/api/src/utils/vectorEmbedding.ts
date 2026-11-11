export const VECTOR_DIMENSIONS = 1024
export const VECTOR_MODEL = 'jina-embeddings-v5-omni-small'
export const VECTOR_REQUEST_BYTES = 1024 * 1024
export const VECTOR_MEDIA_REQUEST_BYTES = 12 * 1024 * 1024
export const VECTOR_PDF_MAX_BYTES = 8_000_000
export const VECTOR_BATCH_SIZE = 32

export type ModelInput = { text: string } | { image: string } | { content: ({ text: string } | { image: string })[] }
export type VectorModality = 'text' | 'image' | 'pdf'
export interface EmbeddedPart {
  values: number[]
  weight: number
  modality: VectorModality
}

export class ArticleVectorAccumulator {
  private readonly sums = new Map<VectorModality, Float64Array>()

  add(part: EmbeddedPart) {
    let sum = this.sums.get(part.modality)
    if (!sum) {
      sum = new Float64Array(VECTOR_DIMENSIONS)
      this.sums.set(part.modality, sum)
    }
    addVector(sum, part.values, part.weight)
  }

  values(): number[] {
    const combined = new Float64Array(VECTOR_DIMENSIONS)
    for (const sum of this.sums.values()) addVector(combined, sum)
    return normalized(combined)
  }
}

export function normalized(values: ArrayLike<number>): number[] {
  if (values.length !== VECTOR_DIMENSIONS) throw new Error('invalid_vector_dimensions')
  let norm = 0
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new Error('invalid_vector_value')
    norm += values[i] * values[i]
  }
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('empty_vector')
  norm = Math.sqrt(norm)
  return Array.from(values, value => value / norm)
}

export function addVector(sum: Float64Array, values: ArrayLike<number>, weight = 1) {
  const unit = normalized(values)
  if (!Number.isFinite(weight) || weight <= 0) throw new Error('invalid_vector_weight')
  for (let i = 0; i < sum.length; i++) sum[i] += unit[i] * weight
}

export function estimatedTokens(text: string): number {
  let ascii = 0
  let other = 0
  for (const char of text) {
    if (char.codePointAt(0)! < 128) ascii++
    else other++
  }
  return Math.ceil(ascii / 3 + other * 1.5)
}

export function bisectText(text: string): [string, string] {
  if (text.length < 2) throw new Error('input_cannot_be_split')
  let middle = Math.floor(text.length / 2)
  if (/[\uDC00-\uDFFF]/.test(text[middle])) middle--
  if (!middle) throw new Error('input_cannot_be_split')
  return [text.slice(0, middle), text.slice(middle)]
}

export function modelPayload(input: ModelInput[] | { pdf: string }) {
  return { model: VECTOR_MODEL, task: 'text-matching', dimensions: VECTOR_DIMENSIONS, normalized: true, embedding_type: 'float', truncate: false, input }
}

export function requestBytes(input: ModelInput[]): number {
  return new TextEncoder().encode(JSON.stringify(modelPayload(input))).length
}

export function* textInputs(text: string): Generator<ModelInput> {
  if (!text) return
  if (requestBytes([{ text }]) <= VECTOR_REQUEST_BYTES) {
    yield { text }
    return
  }
  for (const part of bisectText(text)) yield* textInputs(part)
}
