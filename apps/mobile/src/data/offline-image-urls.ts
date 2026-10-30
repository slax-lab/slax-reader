import {normalizeImageUrl} from './cache-paths.ts';
import {rewriteReaderImageTransports} from '../reader/image-transports.ts';

function decodeImageAttribute(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = {'&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>'};
    const known = named[entity.toLowerCase()]; if (known !== undefined) return known;
    const code = /^&#x/i.test(entity) ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\uFFFD';
  });
}
/** Reference image-URL extraction rules the native offline engine must match (golden fixture parity). */
export function offlineImageUrls(html: string): string[] {
  const urls: string[] = [];
  rewriteReaderImageTransports(html, value => {
    const url = normalizeImageUrl(decodeImageAttribute(value));
    if (/^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
  });
  return urls;
}
