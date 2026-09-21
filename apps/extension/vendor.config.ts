// dev-only 重依赖 vendor 外置的共享接线
// baseDir 传扩展目录（本项目根目录）
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ResolvedPublicFile } from 'wxt'

type ManifestLike = { content_scripts?: { js?: string[]; css?: string[]; matches?: string[]; run_at?: string }[] }

export function vendorExternalize(baseDir: string, isDev: boolean) {
  const vendorPath = path.resolve(baseDir, '.vendor/vendor.js')
  const useVendor = isDev && existsSync(vendorPath)
  const shim = (file: string) => path.resolve(baseDir, 'vendor-shims', file)

  // 精确正则，避免误伤 styles css
  const aliases = useVendor
    ? [
        { find: /^markmap-common$/, replacement: shim('markmap-common.ts') },
        { find: /^markmap-lib$/, replacement: shim('markmap-lib.ts') },
        { find: /^markmap-view$/, replacement: shim('markmap-view.ts') },
        { find: /^highlight\.js$/, replacement: shim('highlight-js.ts') },
        { find: /^@vscode\/markdown-it-katex$/, replacement: shim('vscode-markdown-it-katex.ts') }
      ]
    : []

  return {
    useVendor,
    vendorPath,
    // 追加进 resolve.alias
    aliases,
    // 拷 vendor.js 进产物根
    extendPublicAssets(files: ResolvedPublicFile[]) {
      if (useVendor) files.push({ absoluteSrc: vendorPath, relativeDest: 'vendor.js' })
    },
    // vendor 须先于 content 注入
    extendManifest(manifest: ManifestLike) {
      if (!useVendor) return
      manifest.content_scripts ??= []
      manifest.content_scripts.unshift({ js: ['vendor.js'], matches: ['<all_urls>'], run_at: 'document_idle' })
    }
  }
}
