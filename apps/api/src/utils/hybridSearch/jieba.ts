import { DurableObject } from 'cloudflare:workers'
import { RequestUtils } from '../requestUtils'
import { Failed, NotFound, Successed } from '../responseUtils'

type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module

interface JiebaWasmType {
  readonly memory: WebAssembly.Memory
  readonly cut: (a: number, b: number, c: number) => [number, number]
  readonly cut_all: (a: number, b: number) => [number, number]
  readonly cut_for_search: (a: number, b: number, c: number) => [number, number]
  readonly tokenize: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number]
  readonly add_word: (a: number, b: number, c: number, d: number, e: number, f: number) => number
  readonly load_user_dict: (a: number, b: number) => [number, number]
  readonly tag: (a: number, b: number, c: number) => [number, number]
  readonly __wbindgen_malloc: (a: number, b: number) => number
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number
  readonly __wbindgen_export_2: WebAssembly.Table
  readonly __externref_drop_slice: (a: number, b: number) => void
  readonly __wbindgen_free: (a: number, b: number, c: number) => void
  readonly __externref_table_dealloc: (a: number) => void
  readonly __wbindgen_start: () => void
}

export class SlaxJieba extends DurableObject {
  public env: Env
  private wasm?: JiebaWasmType
  private cachedTextDecoder: TextDecoder
  private cachedTextEncoder: TextEncoder
  private cachedUint8ArrayMemory0: Uint8Array | null = null
  private cachedDataViewMemory0: DataView | null = null
  private WASM_VECTOR_LEN = 0
  private processingLock: Promise<void> | null = null
  private lockQueue: Array<() => void> = []
  private readonly MAX_QUEUE_LENGTH = 10000
  private readonly LOCK_TIMEOUT = 5000

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.env = env
    this.cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })
    this.cachedTextEncoder = new TextEncoder()
    this.cachedTextDecoder.decode()
  }

  private getUint8ArrayMemory0(): Uint8Array {
    if (this.cachedUint8ArrayMemory0 === null || this.cachedUint8ArrayMemory0.byteLength === 0) {
      this.cachedUint8ArrayMemory0 = new Uint8Array(this.wasm!.memory.buffer)
    }
    return this.cachedUint8ArrayMemory0
  }

  private getDataViewMemory0(): DataView {
    if (
      this.cachedDataViewMemory0 === null ||
      (this.cachedDataViewMemory0.buffer as any).detached === true ||
      ((this.cachedDataViewMemory0.buffer as any).detached === undefined && this.cachedDataViewMemory0.buffer !== this.wasm!.memory.buffer)
    ) {
      this.cachedDataViewMemory0 = new DataView(this.wasm!.memory.buffer)
    }
    return this.cachedDataViewMemory0
  }

  private debugString(val: any): string {
    const type = typeof val
    if (type == 'number' || type == 'boolean' || val == null) {
      return `${val}`
    }
    if (type == 'string') {
      return `"${val}"`
    }
    if (type == 'symbol') {
      const description = val.description
      if (description == null) {
        return 'Symbol'
      } else {
        return `Symbol(${description})`
      }
    }
    if (type == 'function') {
      const name = val.name
      if (typeof name == 'string' && name.length > 0) {
        return `Function(${name})`
      } else {
        return 'Function'
      }
    }
    if (Array.isArray(val)) {
      const length = val.length
      let debug = '['
      if (length > 0) {
        debug += this.debugString(val[0])
      }
      for (let i = 1; i < length; i++) {
        debug += ', ' + this.debugString(val[i])
      }
      debug += ']'
      return debug
    }
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val))
    let className
    if (builtInMatches!.length > 1) {
      className = builtInMatches![1]
    } else {
      return toString.call(val)
    }
    if (className == 'Object') {
      try {
        return 'Object(' + JSON.stringify(val) + ')'
      } catch (_) {
        return 'Object'
      }
    }
    if (val instanceof Error) {
      return `${val.name}: ${val.message}\n${val.stack}`
    }
    return className
  }

  private getStringFromWasm0(ptr: number, len: number): string {
    return this.cachedTextDecoder.decode(this.getUint8ArrayMemory0().subarray(ptr >>> 0, (ptr >>> 0) + len))
  }

  private isLikeNone(x: any): boolean {
    return x === undefined || x === null
  }

  private getArrayJsValueFromWasm0(ptr: number, len: number): any[] {
    ptr = ptr >>> 0
    const mem = this.getDataViewMemory0()
    const result = []
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
      result.push(this.wasm!.__wbindgen_export_2.get(mem.getUint32(i, true)))
    }
    this.wasm!.__externref_drop_slice(ptr, len)
    return result
  }

  private encodeString(arg: string, view: Uint8Array): { read: number; written: number } {
    if (this.cachedTextEncoder.encodeInto) {
      return this.cachedTextEncoder.encodeInto(arg, view)
    } else {
      const buf = this.cachedTextEncoder.encode(arg)
      view.set(buf)
      return {
        read: arg.length,
        written: buf.length
      }
    }
  }

  private passStringToWasm0(arg: string): number {
    const buf = this.cachedTextEncoder.encode(arg)
    const ptr = this.wasm!.__wbindgen_malloc(buf.length, 1) >>> 0
    this.getUint8ArrayMemory0()
      .subarray(ptr, ptr + buf.length)
      .set(buf)
    this.WASM_VECTOR_LEN = buf.length
    return ptr
  }

  private getImports(): any {
    const imports: any = {}
    imports.wbg = {
      __wbindgen_string_new: (arg0: number, arg1: number) => {
        return this.getStringFromWasm0(arg0, arg1)
      },
      __wbg_new_1e7c00339420672b: () => {
        return new Object()
      },
      __wbindgen_number_new: (arg0: number) => {
        return arg0
      },
      __wbg_set_1754fb90457a8cce: (arg0: any, arg1: string, arg2: any) => {
        arg0[arg1] = arg2
      },
      __wbg_new_70a2f23d1565c04c: (arg0: number, arg1: number) => {
        return new Error(this.getStringFromWasm0(arg0, arg1))
      },
      __wbindgen_debug_string: (arg0: number, arg1: any) => {
        const ret = this.debugString(arg1)
        const ptr1 = this.passStringToWasm0(ret)
        const len1 = this.WASM_VECTOR_LEN
        this.getDataViewMemory0().setInt32(arg0 + 4, len1, true)
        this.getDataViewMemory0().setInt32(arg0, ptr1, true)
      },
      __wbindgen_throw: (arg0: number, arg1: number) => {
        throw new Error(this.getStringFromWasm0(arg0, arg1))
      },
      __wbindgen_init_externref_table: () => {
        const table = this.wasm!.__wbindgen_export_2
        const offset = table.grow(4)
        table.set(0, undefined)
        table.set(offset + 0, undefined)
        table.set(offset + 1, null)
        table.set(offset + 2, true)
        table.set(offset + 3, false)
      }
    }
    return imports
  }

  private async __wbg_load(module: InitInput, imports?: any): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
    if (typeof Response === 'function' && module instanceof Response) {
      if (typeof WebAssembly.instantiateStreaming === 'function') {
        try {
          return await WebAssembly.instantiateStreaming(module, imports)
        } catch (e) {
          if (module.headers.get('Content-Type') != 'application/wasm') {
            console.warn('`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type.')
          } else {
            throw e
          }
        }
      }

      const bytes = await module.arrayBuffer()
      return await WebAssembly.instantiate(bytes, imports)
    } else {
      const instance = await WebAssembly.instantiate(module as BufferSource | WebAssembly.Module, imports)
      if (instance instanceof WebAssembly.Instance) {
        return { instance, module }
      } else {
        return instance
      }
    }
  }

  private __wbg_init_memory(imports?: any): void {}

  private __wbg_finalize_init(instance: WebAssembly.Instance, module?: any): JiebaWasmType {
    this.wasm = instance.exports as unknown as JiebaWasmType
    this.wasm.__wbindgen_start()
    return this.wasm
  }

  private async __wbg_init(moduleOrPath?: InitInput | { module?: InitInput } | string): Promise<JiebaWasmType> {
    let module
    if (typeof moduleOrPath === 'undefined') {
      module = new URL('jieba_rs_wasm_bg.wasm', import.meta.url)
    } else if (typeof moduleOrPath === 'string') {
      module = moduleOrPath
    } else if (moduleOrPath instanceof URL) {
      module = moduleOrPath
    } else if (moduleOrPath instanceof Response) {
      module = moduleOrPath
    } else if ('module' in moduleOrPath) {
      module = moduleOrPath.module
    } else {
      module = moduleOrPath
    }

    const imports = this.getImports()
    this.__wbg_init_memory(imports)
    const instance = await WebAssembly.instantiate(module as BufferSource | WebAssembly.Module, imports)
    return this.__wbg_finalize_init(instance)
  }

  async initialize(): Promise<void> {
    if (this.wasm) return
    const wasmModule = await import('../wasmJieba/jieba_rs_wasm_bg.wasm')
    await this.__wbg_init(wasmModule.default)
  }

  async cut(text: string, hmm?: boolean): Promise<string[]> {
    await this.monitorMemory()
    const ptr = this.passStringToWasm0(text)
    const len = this.WASM_VECTOR_LEN
    const ret = this.wasm!.cut(ptr, len, this.isLikeNone(hmm) ? 0xffffff : hmm ? 1 : 0)
    const result = this.getArrayJsValueFromWasm0(ret[0], ret[1])
    this.wasm!.__wbindgen_free(ret[0], ret[1] * 4, 4)
    return result
  }

  async cutAll(text: string): Promise<string[]> {
    await this.monitorMemory()
    const ptr = this.passStringToWasm0(text)
    const len = this.WASM_VECTOR_LEN
    const ret = this.wasm!.cut_all(ptr, len)
    const result = this.getArrayJsValueFromWasm0(ret[0], ret[1])
    this.wasm!.__wbindgen_free(ret[0], ret[1] * 4, 4)
    return result
  }

  async cutForSearch(text: string, hmm?: boolean): Promise<string[]> {
    await this.monitorMemory()
    const ptr = this.passStringToWasm0(text)
    const len = this.WASM_VECTOR_LEN
    const ret = this.wasm!.cut_for_search(ptr, len, this.isLikeNone(hmm) ? 0xffffff : hmm ? 1 : 0)
    const result = this.getArrayJsValueFromWasm0(ret[0], ret[1])
    this.wasm!.__wbindgen_free(ret[0], ret[1] * 4, 4)
    return result
  }

  private async acquireLock(): Promise<void> {
    if (this.lockQueue.length >= this.MAX_QUEUE_LENGTH) {
      throw new Error('Too many pending requests')
    }

    if (!this.processingLock) {
      this.processingLock = new Promise(resolve => this.lockQueue.push(resolve))
    } else {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Lock acquisition timeout')), this.LOCK_TIMEOUT)
      })

      const lockPromise = new Promise<void>(resolve => this.lockQueue.push(resolve))
      await Promise.race([this.processingLock, timeoutPromise])
      this.processingLock = lockPromise
    }
  }

  private releaseLock(): void {
    const nextResolve = this.lockQueue.shift()
    if (nextResolve) {
      nextResolve()
    } else {
      this.processingLock = null
    }
  }

  async monitorMemory(): Promise<void> {
    try {
      await this.acquireLock()
      if (!this.wasm) await this.initialize()
      const memoryMB = this.wasm!.memory.buffer.byteLength / 1024 / 1024
      console.log(`Memory usage: ${memoryMB.toFixed(2)} MB`)

      // 检查内存状态
      const memory = this.getUint8ArrayMemory0()
      if (memoryMB > 120) {
        console.log('Reinitializing WASM due to high memory usage')
        this.wasm = undefined
        this.cachedUint8ArrayMemory0 = null
        this.cachedDataViewMemory0 = null
        this.WASM_VECTOR_LEN = 0
        await this.initialize()
      }
    } catch (error) {
      console.error('Error in monitorMemory:', error)
      throw error
    } finally {
      // 释放锁
      this.releaseLock()
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const { text, hmm } = await RequestUtils.json<{ text: string; hmm: boolean }>(request)

    if (!text) return new Response('Text is required', { status: 400 })

    try {
      switch (url.hostname) {
        case 'cut': {
          return Successed(await this.cut(text, hmm))
        }
        case 'cut_all': {
          return Successed(await this.cutAll(text))
        }
        case 'cut_for_search': {
          return Successed(await this.cutForSearch(text, hmm))
        }
        default:
          return NotFound('Not found')
      }
    } catch (error) {
      console.error('Error processing request:', error)
      return Failed(error instanceof Error ? error.message : 'Internal server error')
    }
  }
}
