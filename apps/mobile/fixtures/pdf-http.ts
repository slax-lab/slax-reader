export const PDF_HTTP_ORIGIN = 'http://127.0.0.1:8093';
export const PDF_HTTP_TOKEN = 'slax-pdf-loopback-synthetic-only';
export const PDF_HTTP_BOOKMARK = 'fixture-pdf-http';
export type PdfHttpMode = 'normal' | 'metadata-404' | 'slow';

export interface PdfHttpObservation {path: string; outcome: 'response' | 'network-error' | 'aborted'; status?: number}
export function createPdfHttpFetch(transport: typeof globalThis.fetch, observe: (event: PdfHttpObservation) => void = () => {}): typeof globalThis.fetch {
  return async (input, init) => {
    const request = typeof input === 'object' && 'url' in input ? input as Request : null;
    const url = new URL(request?.url ?? String(input));
    if (url.origin !== PDF_HTTP_ORIGIN || url.username || url.password || url.hash) throw new Error('PDF fixture rejected a non-loopback request');
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    if (headers.get('Authorization') !== `Bearer ${PDF_HTTP_TOKEN}`) throw new Error('PDF fixture requires synthetic authorization');
    const bookmark = ['/v1/bookmark/metadata', '/v1/bookmark/pdf', '/v1/mark/users'].includes(url.pathname);
    const control = url.pathname === '/__fixture/control' && method === 'POST' && ['normal', 'metadata-404', 'slow'].includes(url.searchParams.get('mode') ?? '');
    if (bookmark ? method !== 'GET' || url.searchParams.get('bookmark_uid') !== PDF_HTTP_BOOKMARK || [...url.searchParams.keys()].some(key => key !== 'bookmark_uid') : !control && !(method === 'GET' && ['/v1/user/labs', '/m', '/__fixture/status'].includes(url.pathname) && !url.search)) throw new Error('Unprepared PDF loopback route');
    if (control && [...url.searchParams.keys()].some(key => key !== 'mode') || init?.body != null || request?.body != null) throw new Error('PDF loopback fixture does not accept request bodies');
    const signal = init?.signal ?? request?.signal;
    try {
      const response = await transport(input, {...init, redirect: 'error'});
      observe({path: url.pathname, outcome: 'response', status: response.status}); return response;
    } catch (error) {
      observe({path: url.pathname, outcome: signal?.aborted ? 'aborted' : 'network-error'}); throw error;
    }
  };
}
