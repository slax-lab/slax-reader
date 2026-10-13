import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import type { Plugin } from 'vite'

/** Keep upstream viewer styles and its custom properties inside the PDF reader. */
export function scopedPdfStyles(): Plugin {
  return {
    name: 'slax-pdf-styles', enforce: 'pre',
    transform(source, id) {
      if (!id.includes('pdfjs-dist/web/pdf_viewer.css')) return
      const css = postcss.parse(source)
      css.walkRules(rule => {
        let parent = rule.parent
        while (parent) {
          if (parent.type === 'rule' || (parent.type === 'atrule' && /keyframes$/i.test(parent.name))) return
          parent = parent.parent
        }
        rule.selector = selectorParser(selectors => {
          selectors.each(selector => {
            const root = selector.nodes.find(node => node.type === 'pseudo' && node.value === ':root')
            if (root) root.replaceWith(selectorParser.className({ value: 'pdf-reader' }))
            else {
              selector.prepend(selectorParser.combinator({ value: ' ' }))
              selector.prepend(selectorParser.className({ value: 'pdf-reader' }))
            }
          })
        }).processSync(rule.selector)
      })
      return { code: css.toString(), map: null }
    }
  }
}
