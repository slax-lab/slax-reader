/** Add the controlled fixture policy before any document resource is parsed. */
export function fixtureDocument(html: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'">`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (!head) {
    const root = /<html(?:\s[^>]*)?>/i.exec(html);
    const doctype = /^\s*<!doctype\s[^>]*>/i.exec(html);
    const index = root ? root.index + root[0].length : doctype ? doctype[0].length : 0;
    return html.slice(0, index) + (root ? `<head>${policy}</head>` : policy) + html.slice(index);
  }
  const index = head.index + head[0].length;
  return html.slice(0, index) + policy + html.slice(index);
}
