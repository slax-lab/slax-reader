interface NoticeGeometry {kind?: unknown; generation?: unknown; documentUrl?: unknown; ready?: unknown; hasContent?: unknown; height?: unknown; visible?: unknown; y?: unknown}
function atBottom(height: unknown, visible: unknown, y: unknown): boolean {
  return typeof height === 'number' && Number.isFinite(height) && height > 0 &&
    typeof visible === 'number' && Number.isFinite(visible) && visible > 0 &&
    typeof y === 'number' && Number.isFinite(y) && y >= 0 && y + visible >= height - 5;
}

/** Native scroll geometry is useful only after the current notice document is verified. */
export class NoticeReadGate {
  private generation = 0;
  private state: 'loading' | 'awaiting-document' | 'verified' | 'failed' = 'loading';
  private readonly noticeUrl: string;
  private readonly localDocument: boolean;
  canDelete = false;
  inspect(): {generation: number; state: 'loading' | 'awaiting-document' | 'verified' | 'failed'; canDelete: boolean} {
    return {generation: this.generation, state: this.state, canDelete: this.canDelete};
  }
  constructor(noticeUrl: string, localDocument: boolean) {this.noticeUrl = noticeUrl; this.localDocument = localDocument;}
  allows(url: string): boolean {
    if (this.localDocument) return url === 'about:blank';
    try {const actual = new URL(url), expected = new URL(this.noticeUrl); return actual.origin === expected.origin && actual.pathname === expected.pathname;} catch {return false;}
  }
  beginLoad(): void {this.generation += 1; this.state = 'loading'; this.canDelete = false;}
  fail(): void {this.generation += 1; this.state = 'failed'; this.canDelete = false;}
  loadSucceeded(url: string): number | null {
    if (this.state !== 'loading' || !this.allows(url)) return null;
    this.state = 'awaiting-document'; return this.generation;
  }
  private allowsMessageSource(sourceUrl: string, documentUrl: unknown): boolean {
    if (typeof documentUrl !== 'string' || !this.allows(documentUrl)) return false;
    // Android's WebMessageListener reports sourceOrigin; the fallback bridge
    // and iOS report the full document URL. Both must match the loaded notice.
    if (this.localDocument) return sourceUrl === 'null' || sourceUrl === 'about:blank';
    return this.allows(sourceUrl) || sourceUrl === new URL(this.noticeUrl).origin;
  }
  documentGeometry(url: string, data: NoticeGeometry): boolean {
    if (!this.allowsMessageSource(url, data.documentUrl) || data.kind !== 'delete-notice-geometry' || data.generation !== this.generation ||
      (this.state !== 'awaiting-document' && this.state !== 'verified')) return this.canDelete;
    if (data.ready !== true || data.hasContent !== true || typeof data.height !== 'number' || !Number.isFinite(data.height) || data.height <= 0 ||
      typeof data.visible !== 'number' || !Number.isFinite(data.visible) || data.visible <= 0 || typeof data.y !== 'number' || !Number.isFinite(data.y) || data.y < 0) {
      this.state = 'awaiting-document'; this.canDelete = false; return false;
    }
    this.state = 'verified';
    this.canDelete ||= atBottom(data.height, data.visible, data.y);
    return this.canDelete;
  }
  nativeGeometry(height: number, visible: number, y: number): boolean {
    if (this.state === 'verified') this.canDelete ||= atBottom(height, visible, y);
    return this.canDelete;
  }
}

export function noticeGeometryScript(generation: number): string {
  return `(() => {
    const report = () => {
      const body = document.body;
      const height = Math.max(document.documentElement.scrollHeight, body?.scrollHeight || 0);
      window.ReactNativeWebView.postMessage(JSON.stringify({kind:'delete-notice-geometry',generation:${generation},documentUrl:window.location.href,ready:document.readyState==='complete',hasContent:!!body?.innerText.trim(),height,visible:window.innerHeight,y:window.scrollY}));
    };
    window.addEventListener('scroll',report,{passive:true});
    window.addEventListener('resize',report,{passive:true});
    requestAnimationFrame(() => requestAnimationFrame(report));
  })(); true;`;
}
