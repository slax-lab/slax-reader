// 定位本地后端仓库目录
// 由 SLAX_BACKEND_DIR 指定，缺失即报错

import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 复用 env.ts 的 .env 加载，保持一致
const slaxEnv = process.env.SLAX_ENV || 'development'
for (const file of ['.env', `.env.${slaxEnv}`, `.env.${slaxEnv}.local`]) {
  const envPath = path.resolve(__dirname, '..', file)
  // quiet 抑制日志，防止污染 stdout
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, quiet: true })
}

function backendDir(): string {
  const dir = process.env.SLAX_BACKEND_DIR
  if (!dir) {
    throw new Error(
      '[backend] 环境变量 SLAX_BACKEND_DIR 未设置。\n' +
        '  它必须指向本地 slax_reader_backend 检出目录（绝对路径），例如：\n' +
        '    SLAX_BACKEND_DIR=/absolute/path/to/slax_reader_backend\n' +
        '  请在 deploy/local_web/.env 中声明，再从根目录运行 pnpm web -- dev（环境文件已被 gitignore）。'
    )
  }
  const abs = path.resolve(dir)
  if (!fs.existsSync(abs)) {
    throw new Error(`[backend] SLAX_BACKEND_DIR 指向的目录不存在：${abs}`)
  }
  return abs
}

function need(p: string, what: string): string {
  if (!fs.existsSync(p)) {
    throw new Error(`[backend] 未找到 ${what}：${p}\n  （请确认后端已至少运行过一次 wrangler dev 以生成本地状态）`)
  }
  return p
}

export const backendStateV3 = (): string => need(path.join(backendDir(), 'config/.wrangler/state/v3'), 'wrangler 本地状态 (state/v3)')
export const backendStateDir = (): string => need(path.join(backendDir(), 'config/.wrangler/state'), 'wrangler 本地状态 (state)')
export const backendProdToml = (): string => need(path.join(backendDir(), 'config/prod.toml'), 'prod.toml')

// CLI 入口：仅直接执行时触发
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href
if (isMain) {
  const targets: Record<string, () => string> = { stateV3: backendStateV3, stateDir: backendStateDir, prodToml: backendProdToml }
  const fn = targets[process.argv[2]!]
  if (!fn) {
    console.error(`用法: jiti backend-path.ts <${Object.keys(targets).join('|')}>`)
    process.exit(1)
  }
  process.stdout.write(fn())
}
