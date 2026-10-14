// 预打包重依赖为 vendor.js（dev 外置提速）
// 升级三库后重跑，见 vendor.config.ts
import { build } from 'esbuild'
import { mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extDir = path.resolve(scriptDir, '..')
const outDir = path.join(extDir, '.vendor')
const outfile = path.join(outDir, 'vendor.js')

// katex 随插件一并打包
const entry = `
import * as markmapCommon from 'markmap-common'
import * as markmapLib from 'markmap-lib'
import * as markmapView from 'markmap-view'
import hljs from 'highlight.js'
import MdKatex from '@vscode/markdown-it-katex'
;(globalThis).__SLAX_VENDOR__ = { markmapCommon, markmapLib, markmapView, hljs, mdKatex: MdKatex }
`

async function main() {
  mkdirSync(outDir, { recursive: true })

  await build({
    stdin: {
      contents: entry,
      // 从扩展目录解析依赖
      resolveDir: extDir,
      loader: 'ts',
      sourcefile: 'vendor-entry.ts'
    },
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome115', // 对齐 chrome 最低版本
    minify: true,
    legalComments: 'none',
    logLevel: 'warning'
  })

  const kb = statSync(outfile).size / 1024
  console.log(`[build-vendor] ✔ 生成 ${path.relative(extDir, outfile)}（${kb.toFixed(0)} kB）`)
}

main().catch(err => {
  console.error('[build-vendor] ✘ 失败：', err)
  process.exit(1)
})
