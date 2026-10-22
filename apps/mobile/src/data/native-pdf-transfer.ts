import {requireNativeModule} from 'expo';
import {throwIfAborted} from '../utils/abort.ts';
import {DataTransportError, NativePdfTransportError} from './transport-errors.ts';

type TransferFailure = {error: 'network' | 'cancelled' | 'protocol' | 'limit' | 'busy'};
type TransferHead = {status: number; headers: Record<string, string>};
export interface NativePdfTransfer {
  begin(owner: string, origin: string): string;
  end(owner: string, id: string): void;
  open(owner: string, id: string, url: string, headers: Record<string, string>): Promise<TransferHead | TransferFailure>;
  read(owner: string, id: string): Promise<Uint8Array | null | TransferFailure>;
}
function failed(value: TransferFailure): never {
  if (value.error === 'network') throw new DataTransportError('network', 'pdf-range');
  if (value.error === 'cancelled') throw Object.assign(new Error('PDF transfer cancelled'), {name: 'AbortError'});
  throw new NativePdfTransportError(value.error === 'busy' ? 'resource_busy' : 'pdf_body_invalid');
}
export function createNativePdfFetch(scope: () => {owner: string; origin: string} | null): typeof globalThis.fetch {
  return async (input, request) => {
    const url = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    const captured = scope(), signal = request?.signal;
    const check = () => {
      throwIfAborted(signal ?? undefined);
      const current = scope();
      if (!captured || current?.owner !== captured.owner || current.origin !== captured.origin) throw Object.assign(new Error('PDF owner released'), {name: 'AbortError'});
    };
    check();
    if (url.origin !== captured!.origin || url.pathname !== '/v1/bookmark/pdf' || request?.method !== 'GET' || request.body != null || request.redirect !== 'error') throw new Error('Invalid native PDF request');
    const native = requireNativeModule<NativePdfTransfer>('SlaxPdfTransfer'), owner = captured!.owner;
    let id: string;
    try {id = native.begin(owner, captured!.origin);} catch {check(); throw new NativePdfTransportError('resource_busy');}
    let ended = false, controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const close = () => {if (ended) return; ended = true; signal?.removeEventListener('abort', abort); native.end(owner, id);};
    const abort = () => {close(); try {throwIfAborted(signal ?? undefined);} catch (error) {controller?.error(error);}};
    signal?.addEventListener('abort', abort, {once: true});
    try {
      check();
      const headers: Record<string, string> = {}; new Headers(request.headers).forEach((value, key) => {headers[key] = value;});
      const head = await native.open(owner, id, url.toString(), headers); check();
      if ('error' in head) failed(head);
      if (!Number.isInteger(head.status) || head.status < 100 || head.status > 599) throw new Error('Invalid native PDF response');
      const body = new ReadableStream<Uint8Array>({
        start(value) {controller = value;},
        async pull(value) {
          try {
            check(); const chunk = await native.read(owner, id); check();
            if (ended) return;
            if (chunk === null) {close(); value.close(); return;}
            if (!(chunk instanceof Uint8Array)) failed(chunk);
            if (!chunk.byteLength || chunk.byteLength > 64 * 1024) throw new NativePdfTransportError('pdf_body_invalid');
            value.enqueue(chunk);
          } catch (error) {const closed = ended; close(); if (!closed) value.error(error);}
        },
        cancel() {close();},
      }, {highWaterMark: 0});
      return {status: head.status, headers: new Headers(head.headers), body} as Response;
    } catch (error) {close(); throw error;}
  };
}
