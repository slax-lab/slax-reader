import {readerSignedImageProxy} from './security.ts';

const whitespace = (value: string) => /[\t\n\f\r ]/.test(value);
function rewriteImageTag(tag: string, onImage?: (url: string) => void, mediaOrigins?: readonly string[]): string {
  const replacements: {start: number; end: number; value: string}[] = [];
  let index = /^<[a-z0-9:-]+/i.exec(tag)?.[0].length ?? 4;
  while (index < tag.length) {
    while (whitespace(tag[index] ?? '')) index++;
    if (tag[index] === '>' || tag[index] === '/' || index >= tag.length) break;
    const nameStart = index;
    while (index < tag.length && !whitespace(tag[index]!) && !['=', '>', '/'].includes(tag[index]!)) index++;
    const name = tag.slice(nameStart, index).toLowerCase();
    while (whitespace(tag[index] ?? '')) index++;
    if (tag[index] !== '=') continue;
    index++;
    while (whitespace(tag[index] ?? '')) index++;
    const quote = tag[index] === '"' || tag[index] === "'" ? tag[index++] : null;
    const start = index;
    if (quote) {while (index < tag.length && tag[index] !== quote) index++;}
    else {while (index < tag.length && !whitespace(tag[index]!) && tag[index] !== '>') index++;}
    if (name === 'src' || mediaOrigins && name === 'poster') {
      const value = tag.slice(start, index);
      let rewritten = value.replace(/^https:\/\//i, 'slaxstatics://').replace(/^http:\/\//i, 'slaxstatic://');
      if (mediaOrigins && name === 'src') {
        const decoded = value.replace(/&amp;/gi, '&');
        let signed = readerSignedImageProxy(decoded, mediaOrigins);
        try { signed = signed && !new URL(decoded).searchParams.has('m'); } catch { signed = false; }
        rewritten = signed ? value.replace(/^https:\/\//i, 'slaxmedias://').replace(/^http:\/\//i, 'slaxmedia://') : value;
      }
      if (rewritten && !/^data:/i.test(rewritten)) onImage?.(rewritten);
      if (value !== rewritten) replacements.push({start, end: index, value: rewritten});
    }
    if (quote && tag[index] === quote) index++;
  }
  let result = ''; let start = 0;
  for (const replacement of replacements) {result += tag.slice(start, replacement.start) + replacement.value; start = replacement.end;}
  return result + tag.slice(start);
}

/** Rewrite image attributes before HTML parsing starts requests, without serializing or restructuring the DOM. */
export function rewriteReaderImageTransports(html: string, onImage?: (url: string) => void, mediaOrigins?: readonly string[]): string {
  let rawText: string | null = null;
  let videoDepth = 0;
  const rawElements = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
  return html.replace(/<!--[\s\S]*?(?:-->|$)|<![^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)(?=[\t\n\f\r />])(?:"[^"]*"|'[^']*'|[^'">])*>/g, (tag: string, closing: string | undefined, name: string | undefined) => {
    if (!name) return tag;
    const element = name.toLowerCase();
    if (rawText) {
      if (closing && element === rawText && rawText !== 'plaintext') rawText = null;
      return tag;
    }
    if (!closing && rawElements.has(element)) {rawText = element; return tag;}
    if (element === 'video') videoDepth = Math.max(0, videoDepth + (closing ? -1 : 1));
    if (closing) return tag;
    if ((element === 'video' || element === 'source' && videoDepth > 0) && mediaOrigins) return rewriteImageTag(tag, undefined, mediaOrigins);
    return element === 'img' ? rewriteImageTag(tag, onImage) : tag;
  });
}
