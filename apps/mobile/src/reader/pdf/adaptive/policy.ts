export type PdfAdaptiveMode = 'single' | 'spread';
export type PdfInsets = {left: number; right: number};
export type PdfLayoutInput = {
  enabled: boolean;
  supported: boolean;
  windowWidth: number;
  safeArea: PdfInsets;
  minPaneWidth: number;
  gutter: number;
};
export type PdfLayoutDecision = {mode: PdfAdaptiveMode; usableWidth: number; paneWidth: number};

/** Chooses layout only from the opt-in, platform gate and measured usable scene width. */
export function choosePdfLayout(input: PdfLayoutInput): PdfLayoutDecision {
  const safeLeft = Number.isFinite(input.safeArea.left) ? Math.max(0, input.safeArea.left) : 0;
  const safeRight = Number.isFinite(input.safeArea.right) ? Math.max(0, input.safeArea.right) : 0;
  const usableWidth = Number.isFinite(input.windowWidth) ? Math.max(0, input.windowWidth - safeLeft - safeRight) : 0;
  const gutter = Number.isFinite(input.gutter) ? Math.max(0, input.gutter) : 0;
  const paneWidth = Math.max(0, (usableWidth - gutter) / 2);
  const minimum = Number.isFinite(input.minPaneWidth) ? Math.max(1, input.minPaneWidth) : Number.POSITIVE_INFINITY;
  return {mode: input.enabled && input.supported && paneWidth >= minimum ? 'spread' : 'single', usableWidth, paneWidth};
}

export type PdfProgressAnchor = {page: number; normalizedPosition: number};
export type PdfPagePair = {firstPage: number; secondPage: number | null; anchorPage: number};

/** Pair adjacent document pages; an odd final page has no fabricated partner. */
export function pagesForSpread(anchorPage: number, pageCount: number): PdfPagePair {
  const count = Number.isSafeInteger(pageCount) ? Math.max(0, pageCount) : 0;
  const page = count ? Math.min(count, Math.max(1, Number.isFinite(anchorPage) ? Math.floor(anchorPage) : 1)) : 0;
  if (!page) return {firstPage: 0, secondPage: null, anchorPage: 0};
  const firstPage = Math.floor((page - 1) / 2) * 2 + 1;
  const secondPage = firstPage + 1 <= count ? firstPage + 1 : null;
  return {firstPage, secondPage, anchorPage: page};
}

export function normalizePdfProgress(page: number, positionInPage: number, pageExtent: number): PdfProgressAnchor {
  const safePage = Number.isSafeInteger(page) ? Math.max(1, page) : 1;
  const fraction = Number.isFinite(positionInPage) && Number.isFinite(pageExtent) && pageExtent > 0
    ? Math.min(1, Math.max(0, positionInPage / pageExtent)) : 0;
  return {page: safePage, normalizedPosition: fraction};
}

export function restorePdfProgress(anchor: PdfProgressAnchor, pageExtent: number, pageCount: number): {page: number; positionInPage: number} {
  const count = Number.isSafeInteger(pageCount) ? Math.max(1, pageCount) : 1;
  const page = Math.min(count, Math.max(1, Number.isSafeInteger(anchor.page) ? anchor.page : 1));
  const fraction = Number.isFinite(anchor.normalizedPosition) ? Math.min(1, Math.max(0, anchor.normalizedPosition)) : 0;
  return {page, positionInPage: Number.isFinite(pageExtent) ? Math.max(0, pageExtent) * fraction : 0};
}

export type NormalizedRect = {x: number; y: number; width: number; height: number};
export type PaneBounds = {left: number; top: number; width: number; height: number};
export type MappedRect = {page: number; left: number; top: number; width: number; height: number};

/** Maps page-local normalized annotation geometry into that same page's current pane. */
export function mapPdfAnnotation(page: number, rect: NormalizedRect, pane: PaneBounds): MappedRect | null {
  if (!Number.isSafeInteger(page) || page < 1 || ![rect.x, rect.y, rect.width, rect.height, pane.left, pane.top, pane.width, pane.height].every(Number.isFinite) || pane.width <= 0 || pane.height <= 0) return null;
  const x = Math.min(1, Math.max(0, rect.x)), y = Math.min(1, Math.max(0, rect.y));
  const right = Math.min(1, Math.max(x, rect.x + Math.max(0, rect.width)));
  const bottom = Math.min(1, Math.max(y, rect.y + Math.max(0, rect.height)));
  return {page, left: pane.left + x * pane.width, top: pane.top + y * pane.height, width: (right - x) * pane.width, height: (bottom - y) * pane.height};
}

export function accessibilityPageOrder(pair: PdfPagePair): number[] {
  return [pair.firstPage, pair.secondPage].filter((page): page is number => page !== null && page > 0);
}
