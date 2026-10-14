import autoMigrateIcons from './plugins/auto-migrate-icons.plugin'
import toUtf8 from './plugins/vite-plugin-to-utf8'

import { getEnv, getExtensionsConfig } from './config/env'
import pkg from './package.json'
import { vendorExternalize } from './vendor.config'
import path from 'path'
import { defineConfig } from 'wxt'

const forkRequestPath = path.resolve(__dirname, 'src/bridge/request.ts')

const env = getEnv()
const isDev = env === 'development'
const isPreview = env === 'preview'
console.log('Current env is:', env)

// 各环境独立 key，避免 ID 冲突
const EXTENSION_KEYS = {
  development: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwOLtaiFJ1aq9mECjRNko7GdfIhMELm587YeVP9O+AE3n05+qnAY1nLDviq5MAhZwkfBGMsDgdIZCnZ708vTARHT8eDlPqc4pRTPeeaZYIXl+fRk8EVGvqhYSFUtXZzb9VnvSZ+rdGWzFE7pLn+HQfCuSGMMZrSzuLfGLtksfhvMszT/aKLGkxK0HRUFQLbJQ9ETLm67CFud9FADEi1RCBwxbVP2Tf+R1w1qUdRsV4NDzw2Ya65gV0QWiQtxazf6qL1BRQs5TI+HBoCzuLyK3t/lNAlzVta7wF9fHRhVtconAqgD+N941gEHF7BfRD7DPvuFjAqTKlBeYUZrlISfpoQIDAQAB',
  preview: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7O96PW7mjrzLSjh4IQMCBlH3S2mmYExmMJvdlk9RYIvlSi9glW9PPTV46iKQ7kjzdM/alfPk6wPdiMlWwyZXxgM3GH9l1EIfxrVGydI5/YJS36HZNuerFDD2EciPKzTyz9pUt5LAVjogwWE9va6Soguvq/YO1NMu/oSfkNZ4+sDcpLYTMePNLt0ky0z0Y7uefPiK59pNWesdKTEEGOd3rkVUntgKsfqcmzd5OhOwasVLmgkzfSPflhWykMBBWyIbhYxkOS12PYAPjK8BKjxdBvm5N2F1ToLewSZytUO6PdwP4j7wZk4nStZPmUvA6fkaNW+VOR8z2v2buJs6Pg+29QIDAQAB',
  beta: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwp6yVEk5BVXVOElO6MyR+7QbETf4JnP+RSxnffDQpIWKOst1agoYrHa2+CVoloIe422z0WHxXeIZdHjcrTvUtVEEYpTFc6NYWjjMAvu84y3ELzdGFw/MVHU7gvVkxzz7BjpdZo/OCE2ZW0mK+9ZMjJJ8x6nJpolfKYcgnInDRAoD7Pt+aqmXVC8WrgYte7y0oz2l8q2k9Wd6Nyv+nWXFPidAZKKzuSSI6uXToUPCBixJi+WpV4haPt9nsYXH0GTcHb42KOuN7xi7fKtAxJqmOPyDWw3IRNEz7P5jwFzV7Q7JGbdW2LW6OrrUP5ijrLGOtToPHBy/wLhcRCjz+z0SjQIDAQAB',
  production: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAl+2k+YOZY+29QsqVqtE+G8dqZaKEERBUvnURbHLAd+2JXBDcbWzD759s5BWqEADjg9idLm28lN8suoo2GqwNTUdBX3fBWDvwXS+k47piUdAXiaDuHbd5W18w7ni0ClrudoyJvt74oTprvWaNuj8QdWvvzMxw7a7890HzjiUr5aMptzQarwml2gUFvT0u+mD3nXobRUiAiZPbMTKrflhVb6JL6P7w8K9JWPrhK4nf3Ub4lbXMsVW+pz4QV1NQ31tvUAlx984ujUG+Lqmka2DJJ2RTmSymsvxwRCzfrtao7LIJHPrsUfT5PH6oO+Sf96oUYQ4PgX1A50euxvL06dIMCwIDAQAB'
} as const

// 重依赖 vendor 外置（仅 dev 提速）：预打包 vendor.js（`pnpm build:vendor` 生成），缺失则自动回退正常打包。
const extDir = path.resolve(__dirname)
const vendor = vendorExternalize(extDir, isDev)
if (vendor.useVendor) {
  console.log('[vendor] 已启用 vendor 外置（dev 提速）：markmap / highlight.js / katex')
}

const Version = pkg.version || ''
const envConfig = getExtensionsConfig()
const normalizedEnvConfig = { ...envConfig }
if (isDev) {
  const useLocalhost = normalizedEnvConfig.PUBLIC_BASE_URL === 'http://127.0.0.1:3000'
  for (const key of ['PUBLIC_BASE_URL', 'SHARE_BASE_URL'] as const) {
    if (normalizedEnvConfig[key] === 'http://127.0.0.1:3000') normalizedEnvConfig[key] = 'http://localhost:3000'
  }
  if (useLocalhost && normalizedEnvConfig.COOKIE_DOMAIN === '127.0.0.1') normalizedEnvConfig.COOKIE_DOMAIN = 'localhost'
}
const developmentHostPermissions = [
  'https://*.slax.dev/',
  'http://localhost:3000/*',
  ...(typeof normalizedEnvConfig.PUBLIC_BASE_URL === 'string' ? [`${normalizedEnvConfig.PUBLIC_BASE_URL}/*`] : [])
]

const convertToProcessEnv = (envConfig: Record<string, unknown>) => {
  const result: Record<string, string> = {}
  for (const key in envConfig) {
    result[`process.env.${key}`] = JSON.stringify(envConfig[key] || '')
  }

  result['process.env.SLAX_ENV'] = JSON.stringify(env)
  result['process.env.VERSION'] = JSON.stringify(Version)

  return result
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  imports: {
    addons: {
      vueTemplate: true
    },
    dirs: ['src/utils'],
    imports: [{ name: 'request', from: forkRequestPath }]
  },
  modules: ['@wxt-dev/module-vue', '@wxt-dev/analytics/module', '@wxt-dev/i18n/module', '@wxt-dev/unocss'],
  manifest: {
    name: 'Slax Reader',
    version: Version,
    // 各环境使用独立的 key，避免生成相同扩展 ID 导致本地/beta/preview 与线上版本互相覆盖
    key: EXTENSION_KEYS[env as keyof typeof EXTENSION_KEYS] ?? EXTENSION_KEYS.development,
    description: 'An AI-powered browser extension that generates outlines and highlights key points to enhance your web reading experience.',
    default_locale: 'en',
    permissions: ['storage', 'tabs', 'activeTab', 'sidePanel', 'cookies', 'contextMenus', 'alarms', 'offscreen', 'webRequest'],
    host_permissions: (
      {
        production: ['https://*.slax.app/', 'https://*.slax.com/'],
        beta: ['https://*.slax.app/', 'https://*.slax.com/']
      } as Record<string, string[]>
    )[env] ?? developmentHostPermissions,
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'"
    },
    action: {
      default_icon: {
        '16': 'icon/16.png',
        '32': 'icon/32.png',
        '48': 'icon/48.png',
        '128': 'icon/128.png'
      }
    },
    icons: {
      '16': 'icon/16.png',
      '32': 'icon/32.png',
      '48': 'icon/48.png',
      '128': 'icon/128.png'
    },
    minimum_chrome_version: '115',
    commands: {
      open_collect: {
        suggested_key: {
          default: 'Alt+Y',
          mac: 'Alt+Y',
          linux: 'Alt+Y'
        },
        description: 'Open the collect popup'
      }
    }
  },
  srcDir: 'src',
  outDir: 'build',
  dev: {
    server: {
      port: 3001
    }
  },

  vite: () => ({
    plugins: [toUtf8()],
    define: {
      ...convertToProcessEnv(normalizedEnvConfig)
    },
    // Limit dependency scanning to source entrypoints; Vite 8 otherwise sees
    // stale generated HTML under build/ during dev and reports missing entries.
    optimizeDeps: {
      entries: ['src/entrypoints/**/*.html']
    },
    build: isDev
      ? {
          // sourcemap 默认关以加快冷启动构建（省 ~3s + 不写 7MB map）；
          // 需要断点调试源码时用 `SLAX_SOURCEMAP=1 pnpm dev` 临时开启。
          sourcemap: process.env.SLAX_SOURCEMAP === '1' || process.env.SLAX_SOURCEMAP === 'true',
          minify: false
        }
      : {
          sourcemap: false,
          minify: 'esbuild'
        },
    esbuild: !isDev && !isPreview ? { drop: ['console', 'debugger'] } : undefined,
    resolve: {
      alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }, ...vendor.aliases]
    }
  }),
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.browser === 'firefox') {
        delete manifest.key
        manifest.permissions = manifest.permissions?.filter(permission => permission !== 'offscreen')
      }

      manifest.content_scripts ??= []
      manifest.content_scripts.push({
        css: ['content-scripts/mark.css'],
        matches: ['<all_urls>'],
        run_at: 'document_idle'
      })
      // vendor.js 必须先于主 content 注入（同一 isolated world，先设好 __SLAX_VENDOR__）
      vendor.extendManifest(manifest)
      const vendorScript = manifest.content_scripts?.find(script => script.js?.includes('vendor.js'))
      if (vendorScript) vendorScript.run_at = 'document_start'
    },
    // 'vite:build:extendConfig': (entries, config) => {
    //   const entryNames = entries.reduce((set, entry) => {
    //     set.add(entry.name)
    //     return set
    //   }, new Set<string>())
    //   if (entryNames.has('content')) {
    //     config.plugins!.push(UnoCSS(), autoImportUnoCSS(['content/index.ts']))
    //   }
    // },
    // 'vite:devServer:extendConfig': config => {
    //   config.plugins!.push(UnoCSS(), autoImportUnoCSS(['content/index.ts']))
    // },
    'build:publicAssets': (wxt, files) => {
      autoMigrateIcons(getEnv())(wxt, files)
      // 把预打包的 vendor.js 原样拷进产物根（→ build/vendor.js），供上面的 content_scripts 引用
      vendor.extendPublicAssets(files)
    }
  },
  webExt: {
    chromiumArgs: isDev ? ['--disable-blink-features=AutomationControlled'] : []
  }
})
