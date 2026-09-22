type Bytes = string | ArrayBuffer | Uint8Array | Buffer | null | undefined

export type ServerSentEvent = {
  event: string | null
  data: string
  raw: string[]
}

export class SSEDecoder {
  private data: string[]
  private event: string | null
  private chunks: string[]

  constructor() {
    this.event = null
    this.data = []
    this.chunks = []
  }

  decode(line: string) {
    if (line.endsWith('\r')) {
      line = line.substring(0, line.length - 1)
    }

    if (!line) {
      // empty line and we didn't previously encounter any messages
      if (!this.event && !this.data.length) return null

      const sse: ServerSentEvent = {
        event: this.event,
        data: this.data.join('\n'),
        raw: this.chunks
      }

      this.event = null
      this.data = []
      this.chunks = []

      return sse
    }

    this.chunks.push(line)

    if (line.startsWith(':')) {
      return null
    }

    const result = partition(line, ':')
    if (result.length !== 3) {
      return null
    }

    const fieldname = result[0]
    let value = result[2]

    if (value.startsWith(' ')) {
      value = value.substring(1)
    }

    if (fieldname === 'event') {
      this.event = value
    } else if (fieldname === 'data') {
      this.data.push(value)
    }

    return null
  }
}

/**
 * A re-implementation of httpx's `LineDecoder` in Python that handles incrementally
 * reading lines from text.
 *
 * https://github.com/encode/httpx/blob/920333ea98118e9cf617f246905d7b202510941c/httpx/_decoders.py#L258
 */
export class LineDecoder {
  // prettier-ignore
  static NEWLINE_CHARS = new Set(['\n', '\r']);
  static NEWLINE_REGEXP = /\r\n|[\n\r]/g

  buffer: string[]
  trailingCR: boolean
  textDecoder?: TextDecoder // TextDecoder found in browsers; not typed to avoid pulling in either "dom" or "node" types.

  constructor() {
    this.buffer = []
    this.trailingCR = false
  }

  decode(chunk: Bytes): string[] {
    let text = this.decodeText(chunk)

    if (this.trailingCR) {
      text = '\r' + text
      this.trailingCR = false
    }
    if (text.endsWith('\r')) {
      this.trailingCR = true
      text = text.slice(0, -1)
    }

    if (!text) {
      return []
    }

    const trailingNewline = LineDecoder.NEWLINE_CHARS.has(text[text.length - 1] || '')
    let lines = text.split(LineDecoder.NEWLINE_REGEXP)

    // if there is a trailing new line then the last entry will be an empty
    // string which we don't care about
    if (trailingNewline) {
      lines.pop()
    }

    if (lines.length === 1 && !trailingNewline) {
      this.buffer.push(lines[0]!)
      return []
    }

    if (this.buffer.length > 0) {
      lines = [this.buffer.join('') + lines[0], ...lines.slice(1)]
      this.buffer = []
    }

    if (!trailingNewline) {
      this.buffer = [lines.pop() || '']
    }

    return lines
  }

  decodeText(bytes: Bytes): string {
    if (bytes == null) return ''
    if (typeof bytes === 'string') return bytes

    // Node:
    if (typeof Buffer !== 'undefined') {
      if (bytes instanceof Buffer) {
        return bytes.toString()
      }
      if (bytes instanceof Uint8Array) {
        return Buffer.from(bytes).toString()
      }

      throw new Error(
        `Unexpected: received non-Uint8Array (${bytes.constructor.name}) stream chunk in an environment with a global "Buffer" defined, which this library assumes to be Node. Please report this error.`
      )
    }

    // Browser
    if (typeof TextDecoder !== 'undefined') {
      if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
        this.textDecoder ??= new TextDecoder('utf8')
        return this.textDecoder.decode(bytes, { stream: true })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`Unexpected: received non-Uint8Array/ArrayBuffer (${(bytes as any).constructor.name}) in a web platform. Please report this error.`)
    }

    throw new Error(`Unexpected: neither Buffer nor TextDecoder are available as globals. Please report this error.`)
  }

  flush(): string[] {
    if (!this.buffer.length && !this.trailingCR) {
      return []
    }

    const lines = [this.buffer.join('')]
    this.buffer = []
    this.trailingCR = false
    return lines
  }
}

function partition(str: string, delimiter: string): [string, string, string] {
  const index = str.indexOf(delimiter)
  if (index !== -1) {
    return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)]
  }

  return [str, '', '']
}
