export function normalizeImageUrl(url: string): string { return url.replace(/^slaxstatics:\/\//, 'https://').replace(/^slaxstatic:\/\//, 'http://'); }
export function imageCachePath(bookmarkKey: string, originalUrl: string, md5: (url: string) => string): string {
  const url = normalizeImageUrl(originalUrl);
  const tail = url.includes('.') ? url.slice(url.lastIndexOf('.') + 1) : '';
  const candidate = tail.split('?')[0]!.split('&')[0]!.slice(0, 10).toLowerCase();
  // Keep the source filename rule for safe URLs; an extension must remain one filename component.
  const extension = !candidate || /[\/\\\u0000-\u001f\u007f]/.test(candidate) || candidate.includes('..') ? 'jpg' : candidate;
  return `bookmark/${bookmarkKey}/images/${md5(url)}.${extension}`;
}
