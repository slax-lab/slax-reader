import type { PDFPageView } from 'pdfjs-dist/types/web/pdf_page_view'

/** Let the existing host paper show through, retaining upstream PDF ink rendering. */
export function themedPdfPageView(PageView: typeof PDFPageView, followsTheme: () => boolean) {
  return class extends PageView {
    override _getRenderingContext(...args: Parameters<PDFPageView['_getRenderingContext']>) {
      const context = super._getRenderingContext(...args)
      if (!followsTheme()) return context
      return {
        ...context,
        canvasContext: (context.canvas as HTMLCanvasElement).getContext('2d', { alpha: true }),
        background: 'rgba(0, 0, 0, 0)'
      }
    }
  }
}
