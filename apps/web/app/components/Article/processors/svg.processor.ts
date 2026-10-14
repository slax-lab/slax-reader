import type { DOMProcessor, WebProcessorContext } from './types'

export class SvgProcessor implements DOMProcessor {
  readonly name = 'SvgProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const svgs = Array.from(context.container.querySelectorAll('svg')) as SVGSVGElement[]

    svgs.forEach(svg => {
      const paths = Array.from(svg.getElementsByTagName('path'))
      if (paths.length < 10) {
        svg.setAttribute('style', 'display: none;')
        return
      }

      const viewBox = svg.viewBox
      if (!viewBox) return

      const { width, height } = viewBox.baseVal
      if (width < 5 || height < 5) {
        svg.setAttribute('style', 'display: none;')
      } else {
        svg.setAttribute('style', `width: ${width}px !important; height: ${height}px !important;`)
      }
    })
  }
}
