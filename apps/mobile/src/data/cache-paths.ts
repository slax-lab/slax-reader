export function normalizeImageUrl(url: string): string { return url.replace(/^slaxstatics:\/\//, 'https://').replace(/^slaxstatic:\/\//, 'http://'); }
function imageCacheNames(bookmarkKey: string, originalUrl: string, md5: (url: string) => string) {
  if (!bookmarkKey || /[^\w-]/.test(bookmarkKey)) throw new Error('Invalid article cache key');
  const url = normalizeImageUrl(originalUrl);
  const tail = url.includes('.') ? url.slice(url.lastIndexOf('.') + 1) : '';
  const legacy = tail.split('?')[0]!.split('&')[0]!.slice(0, 10).toLowerCase() || 'jpg';
  const extension = /[\/\\\u0000-\u001f\u007f]/.test(legacy) || legacy.includes('..') ? 'jpg' : legacy;
  return {prefix: `bookmark/${bookmarkKey}/images/${md5(url)}.`, legacy, extension};
}
export function imageCachePath(bookmarkKey: string, originalUrl: string, md5: (url: string) => string): string {
  const {prefix, extension} = imageCacheNames(bookmarkKey, originalUrl, md5);
  return prefix + extension;
}
export function imageCacheReadPaths(bookmarkKey: string, originalUrl: string, md5: (url: string) => string): string[] {
  const {prefix, legacy, extension} = imageCacheNames(bookmarkKey, originalUrl, md5);
  const paths = [prefix + extension];
  if (legacy !== extension && !/[\\\u0000-\u001f\u007f]/.test(legacy) && legacy.split('/').every(part => part !== '' && part !== '.' && part !== '..')) paths.push(prefix + legacy);
  return paths;
}
