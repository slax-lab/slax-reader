export function httpOriginalUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : '';
}
