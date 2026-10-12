/** JSON object envelope. Undefined data is omitted by the existing serializer. */
export type ApiResponse<Data = unknown> = {
  code: number
  message: string
} & (undefined extends Data ? { data?: Exclude<Data, undefined> } : { data: Data })

/** Raw URL search parameters, before any server-side numeric parsing/defaults. */
export interface PageQuery {
  page?: string
  size?: string
}
export interface CursorQuery {
  cursor?: string
}
export interface CursorPage<Item> {
  items: Item[]
  next_cursor: string | null
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
