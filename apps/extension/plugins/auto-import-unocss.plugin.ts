import { type Plugin } from 'vite'

// 现在wxt专门为unocss提供了插件，后续这个可以不需要了
const autoImportUnoCSS: (files: string[]) => Plugin = (files: string[]) => {
  return {
    name: 'auto-import-uno-css',
    apply: () => true,
    enfore: 'pre',
    async transform(code, id) {
      const file = files.find(file => {
        if (id.includes(file) && !code.includes(`import 'virtual:uno.css'`)) {
          return true
        }

        return false
      })

      if (file) {
        return {
          code: `import 'virtual:uno.css';\n${code}`,
          map: null
        }
      }

      return null
    }
  }
}

export default autoImportUnoCSS
