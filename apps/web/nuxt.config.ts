import { backendStateV3 } from './config/backend-path'
import { getDWebConfig, getEnv } from './config/env'
import { POWER_SYNC_WORKER_GENERATION } from './app/local-first/version'
import pkg from './package.json'
import replace from '@rollup/plugin-replace'
import fs from 'fs'
import { fileURLToPath } from 'url'
import wasm from 'vite-plugin-wasm'

const env = getEnv()
console.log('Current env is:', env)

const envConfig = getDWebConfig()

// 仅 dev 需要后端状态；非 dev 置空，
// 避免 CI 因缺 SLAX_BACKEND_DIR 报错
const isDevServer = process.argv.includes('dev')
const backendPersistDir = isDevServer ? backendStateV3() : undefined
const enableDevServiceWorker = isDevServer && ['1', 'true'].includes(`${process.env.ENABLE_DEV_SW || ''}`.toLowerCase())

if (isDevServer) {
  console.log(`[pwa] development service worker ${enableDevServiceWorker ? 'enabled' : 'disabled'} (ENABLE_DEV_SW=${process.env.ENABLE_DEV_SW || 'unset'})`)
}

type SlaxEnv = 'development' | 'preview' | 'beta' | 'production'

interface EnvProfile {
  /** wrangler 顶层 [[services]].service 绑定名 */
  backendService: string
  /** favicon：测试环境用带 .d 的图标做区分 */
  favicon: string
  /** 是否生成 sourcemap */
  sourcemap: boolean
  /** 是否压缩产物（true 走 esbuild minify） */
  minify: boolean
  /** 是否在构建时移除 console/debugger */
  dropConsole: boolean
  /** 是否允许搜索引擎索引 */
  indexable: boolean
  /** PWA 运行模式 */
  pwaMode: 'production' | 'development'
  /** Service Worker 源文件名 */
  swFilename: 'sw_dev.ts' | 'sw_prod.ts'
  /** 是否启用真实 GTM（false 走 mock） */
  enableGtm: boolean
  /**
   * 插件 ext-bridge 允许嵌入的 chrome-extension ID（CSP frame-ancestors + EXTENSION_BRIDGE_IDS）。
   * 必须与 apps/slax-reader-extensions/wxt.config.ts 里 EXTENSION_KEYS[env] 派生出的扩展 ID 一一对应，
   * 否则本地/beta/preview 的 offscreen bridge iframe 会被 CSP 直接拦截、永远拿不到 PowerSync 同步结果。
   */
  extensionBridgeId: string
}

// 所有「跟环境相关」的构建期决策都集中在这张表里：一个环境一列，所见即所得。
// 新增环境只需补一列；config 主体只引用 profile.xxx，不再出现 isDev/isPreview 派生布尔。
const ENV_PROFILES: Record<SlaxEnv, EnvProfile> = {
  development: {
    backendService: 'reader-backend-dev',
    favicon: '/favicon.d.ico',
    sourcemap: true,
    minify: false,
    dropConsole: false,
    indexable: false,
    pwaMode: 'development',
    swFilename: 'sw_dev.ts',
    enableGtm: false,
    extensionBridgeId: 'jgaccepfhchlnpggghoodnklcfcbhhlh'
  },
  preview: {
    backendService: 'reader-backend',
    favicon: '/favicon.d.ico',
    sourcemap: true,
    minify: false,
    dropConsole: false,
    indexable: true,
    pwaMode: 'production',
    swFilename: 'sw_prod.ts',
    enableGtm: true,
    extensionBridgeId: 'nkgkjnjkolpeiodphchpjiggkiciinik'
  },
  beta: {
    backendService: 'slax-read-backend-beta',
    favicon: '/favicon.ico',
    sourcemap: true,
    minify: true,
    dropConsole: false,
    indexable: true,
    pwaMode: 'production',
    swFilename: 'sw_prod.ts',
    enableGtm: true,
    extensionBridgeId: 'bfkggphckdjelkonpoaepppkcecikclp'
  },
  production: {
    backendService: 'slax-read-backend',
    favicon: '/favicon.ico',
    sourcemap: false,
    minify: true,
    dropConsole: true,
    indexable: true,
    pwaMode: 'production',
    swFilename: 'sw_prod.ts',
    enableGtm: true,
    extensionBridgeId: 'gdnhaajlomjkhahnmiijphnodkcfikfd'
  }
}

const profile = ENV_PROFILES[env] ?? ENV_PROFILES.development

// 站点根 URL（结构化/OG 用）
const siteBaseUrl = `${(envConfig.PUBLIC_BASE_URL as string) || ''}`.replace(/\/$/, '')

// 首页 ssr:false 空壳，结构化
// 数据须静态注入 app.head
const homeStructuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Slax Reader', alternateName: 'Slax Reader Web Client', url: `${siteBaseUrl}/` },
    {
      '@type': 'WebApplication',
      name: 'Slax Reader Web Client',
      url: `${siteBaseUrl}/`,
      applicationCategory: 'ProductivityApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      sameAs: ['https://slax.com/reader']
    }
  ]
})

const resolveBackendService = () => process.env.BACKEND_SERVICE_NAME || profile.backendService

const syncBackendServiceBinding = () => {
  const wranglerPath = fileURLToPath(new URL('./wrangler.toml', import.meta.url))
  const service = resolveBackendService()
  const original = fs.readFileSync(wranglerPath, 'utf8')
  const envIdx = original.search(/^\[\[?env\./m)
  const head = envIdx === -1 ? original : original.slice(0, envIdx)
  const tail = envIdx === -1 ? '' : original.slice(envIdx)

  const servicePattern = /(\[\[services\]\][\s\S]*?service\s*=\s*")[^"]*(")/
  if (!servicePattern.test(head)) {
    throw new Error('[backend-binding] 未在顶层找到 [[services]].service，wrangler.toml 结构可能已变，请检查')
  }
  const newHead = head.replace(servicePattern, `$1${service}$2`)

  const written = (newHead.match(/\[\[services\]\][\s\S]*?service\s*=\s*"([^"]*)"/) || [])[1]
  if (written !== service) {
    throw new Error(`[backend-binding] 替换后校验失败：期望 "${service}"，实际 "${written}"`)
  }

  if (newHead !== head) {
    fs.writeFileSync(wranglerPath, newHead + tail)
    console.log(`[backend-binding] top-level service -> "${service}" (SLAX_ENV=${env})`)
  } else {
    console.log(`[backend-binding] top-level service already "${service}" (SLAX_ENV=${env})`)
  }
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  $meta: {
    name: 'slax-reader-dweb'
  },
  content: {
    experimental: {
      sqliteConnector: 'native'
    },
    database: {
      type: 'd1',
      bindingName: 'DB'
    }
  },
  devtools: { enabled: true },
  css: [
    fileURLToPath(new URL('./styles/theme.css', import.meta.url)),
    fileURLToPath(new URL('./styles/global.scss', import.meta.url)),
    fileURLToPath(new URL('./app/assets/styles/fork.tokens.css', import.meta.url))
  ],
  alias: {
    '@': fileURLToPath(new URL('./app', import.meta.url)),
    '@images': fileURLToPath(new URL('./app/assets/images', import.meta.url)),
    '@internal/images': fileURLToPath(new URL('./app/assets/images', import.meta.url))
  },

  app: {
    head: {
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'
        },
        {
          charset: 'utf-8'
        },
        { name: 'description', content: 'Use Slax Reader right in your browser. Sign in to continue reading.' },
        { property: 'og:title', content: 'Slax Reader Web Client' },
        { property: 'og:description', content: 'Use Slax Reader right in your browser — no installation required.' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Slax Reader' },
        { property: 'og:url', content: `${siteBaseUrl}/` }
      ],
      // 站点级默认，SSR 页各自 useSeoMeta 覆盖
      title: 'Slax Reader Web Client',
      link: [
        {
          rel: 'icon',
          type: 'image/png',
          href: profile.favicon
        },
        // 其余页面各自 useSeoMeta 覆盖 canonical；根路径无独立页面组件（由 [...slug].vue 空壳兜底），故这里单独兜底
        { rel: 'canonical', href: `${siteBaseUrl}/` }
      ],
      style: [],
      script: [{ type: 'application/ld+json', innerHTML: homeStructuredData }]
    },
    rootId: 'slax-reader-dweb',
    viewTransition: true,
    pageTransition: { name: 'page', mode: 'out-in' },
    layoutTransition: { name: 'layout', mode: 'out-in' }
  },
  components: {
    dirs: [
      {
        path: '@/components/global',
        global: true
      }
    ]
  },

  modules: [
    './modules/dweb-dev-performance',
    '@pinia/nuxt',
    'pinia-plugin-persistedstate/nuxt',
    '@nuxtjs/i18n',
    '@vueuse/nuxt',
    '@unocss/nuxt',
    '@nuxt/content',
    '@nuxtjs/color-mode',
    '@nuxtjs/turnstile',
    'nuxt-og-image',
    'nuxt-schema-org',
    '@nuxtjs/robots',
    '@nuxtjs/sitemap',
    'nuxt-site-config',
    '@vite-pwa/nuxt',
    '@nuxt/scripts',
    'nitro-cloudflare-dev'
  ],
  // 主题状态由 @nuxtjs/color-mode 管理，双输出 `<html class="dark" data-slax-theme="dark">`
  //   - classSuffix: '' 让生成的类名为 'dark' / 'light' / 'eink'，兼容现有 dark:'class' 与既有 dark: 类
  //   - dataValue: 'slax-theme' 让 data 属性名是 data-slax-theme，避开 daisyUI / Tailwind dark mode 等公网 data-theme 命名空间冲突
  //   - storageKey: 'slax-color-mode' 使用项目私有 localStorage key
  colorMode: {
    preference: 'light',
    fallback: 'light',
    classSuffix: '',
    dataValue: 'slax-theme',
    storageKey: 'slax-color-mode',
    // cookie 让 SSR 读到真实偏好
    // 避免刷新时存储值来回跳变
    storage: 'cookie'
  },

  // workaround for @unocss/nuxt v66 with Nuxt 4: 模块内的 cssnano 配置覆盖只检查 Nuxt 3
  // 详见 https://github.com/unocss/unocss/pull/5200
  postcss: {
    plugins: {
      cssnano: {
        preset: [
          'default',
          {
            mergeRules: false,
            normalizeWhitespace: false,
            discardComments: false
          }
        ]
      }
    }
  },

  i18n: {
    strategy: 'no_prefix',
    locales: [
      { code: 'zh', iso: 'zh-CN', file: 'zh.json' },
      { code: 'en', iso: 'en-US', file: 'en.json' }
    ],
    defaultLocale: 'en',
    langDir: '../i18n/locales/'
  },

  future: {
    compatibilityVersion: 4
  },

  runtimeConfig: {
    public: {
      ...envConfig,
      EXTENSION_BRIDGE_IDS: profile.extensionBridgeId,
      appVersion: pkg.version || '',
      // 暴露构建环境名（development/preview/beta/production），供运行时判定是否为测试环境
      slaxEnv: env
    }
  },

  sourcemap: false,
  vite: {
    plugins: [wasm()],
    // @powersync/web spawns a web worker that itself uses dynamic import()
    // (code-splitting). Rollup forbids iife/umd (Vite's default worker.format)
    // for code-splitting worker bundles, so we force ES module workers. The
    // worker also relies on WASM + top-level await, hence the same plugins.
    // ES module workers support top-level await natively, so we only add the
    // wasm plugin here — including vite-plugin-top-level-await in the worker
    // build trips an esbuild destructuring transform error.
    worker: {
      format: 'es',
      plugins: () => [wasm()],
      // Worker 入口 URL 是 SharedWorker 的身份标识；同一版本保持稳定，
      // 让不同标签页连接同一个 Worker。内部 chunk 仍使用内容哈希。
      rollupOptions: {
        output: {
          // Worker URL 由独立版本控制，数据库文件版本不受影响。
          entryFileNames: `_nuxt/[name]-${POWER_SYNC_WORKER_GENERATION}.js`
        }
      }
    },
    build: {
      target: 'es2022',
      sourcemap: profile.sourcemap,
      minify: profile.minify ? 'esbuild' : false
    },

    esbuild: profile.dropConsole ? { drop: ['console', 'debugger'] } : undefined,
    optimizeDeps: {
      include: [
        'ua-parser-js',
        'dompurify',
        'highlight.js',
        'markdown-it',
        '@vscode/markdown-it-katex',
        'zod',
        'easy-dom2img',
        'markmap-common',
        'markmap-lib',
        'markmap-view',
        'jszip',
        '@powersync/vue',
        '@vueuse/integrations/useCookies',
        'virtua/vue',
        'canvas-confetti',
        // 支付组件 PlanPayment.vue 用到；不预置会在 dev 首次 warmup 中途被运行时发现，
        // 触发依赖重新预构建 + 整页 reload，把已 transform 的成果冲掉重来。
        '@stripe/stripe-js',
        // packages/frontend-utils/src/parse.ts 用到；同样会被运行时发现触发 reload。
        'markdown-it-cjk-friendly'
      ],
      exclude: ['@journeyapps/wa-sqlite', '@powersync/web']
    }
  },
  nitro: {
    cloudflareDev: {
      configPath: fileURLToPath(new URL('./wrangler.local.toml', import.meta.url)),
      environment: 'local',
      persistDir: backendPersistDir
    },
    publicAssets: [
      {
        dir: 'public',
        baseURL: '/',
        maxAge: 0
      }
    ],
    preset: 'cloudflare-pages',
    output: {
      dir: 'dist'
    },
    prerender: {
      // 留空使 sitemap 走运行时
      // 否则合集源构建期取不到→空
      routes: [],
      autoSubfolderIndex: false,
      crawlLinks: true,
      failOnError: true
    },
    routeRules: {
      '/x/ext-bridge': {
        ssr: false,
        prerender: false,
        headers: { 'content-security-policy': `frame-ancestors chrome-extension://${profile.extensionBridgeId}` }
      },
      // i18n 为 no_prefix 策略，/en /zh 不再是有效路由，统一重定向回首页
      '/en': { redirect: '/' },
      '/zh': { redirect: '/' },
      ...['/', '/bookmarks', '/onboarding', '/user', '/login', '/guide', '/auth'].reduce(
        (rules, route) => {
          rules[route] = { ssr: false, prerender: true }
          return rules
        },
        {} as Record<string, { ssr: false; prerender: true }>
      ),
      ...['/', '/bookmarks', '/onboarding', '/user', '/login', '/guide', '/auth'].reduce(
        (rules, route) => {
          rules[route] = { ssr: false, prerender: true }
          return rules
        },
        {} as Record<string, { ssr: false; prerender: true }>
      ),
      ...['/bookmarks/**', '/import-failures'].reduce(
        (rules, route) => {
          rules[route] = { ssr: false, prerender: false }
          return rules
        },
        {} as Record<string, { ssr: false; prerender: false }>
      ),
      ...['/*-reader'].reduce(
        (rules, route) => {
          rules[route] = { ssr: true, prerender: false }
          return rules
        },
        {} as Record<string, { ssr: true; prerender: false }>
      ),
      // dashboard 的鉴权 middleware 会在异步请求后决定 404，暂不流式提交响应。
      '/dashboard': { ssr: true, prerender: false, streaming: false },
      ...['/s/**'].reduce(
        (rules, route) => {
          rules[route] = { ssr: true, prerender: false }
          return rules
        },
        {} as Record<string, { ssr: true; prerender: false }>
      ),
      ...['/privacy', '/terms', '/how-do-i-delete-my-account', '/delete-account-notice'].reduce(
        (rules, route) => {
          rules[route] = { ssr: true, prerender: true }
          return rules
        },
        {} as Record<string, { ssr: true; prerender: true }>
      ),
      // 条款页不参与排名：GSC 2026-09 /terms 97 次曝光、排名 5.6、0 点击，只是在品牌词上分走曝光。
      '/terms': { ssr: true, prerender: true, robots: false },
      // robots.txt 保持预渲染
      '/robots.txt': { prerender: true },
      // 分享页会在异步取数后追加响应头，且当前边缘缓存只接收完整字符串 HTML。
      '/b/**': { ssr: true, prerender: false, streaming: false },
      // 公开合集页 SSR：首屏出数、服务端判 is_owner
      // /c/:id/:cid 一并 SSR，旧链 302 直跳生效
      // 合集页会在异步取数后决定 302/404/502，须保持 buffered renderer。
      '/c/:id': { ssr: true, prerender: false, streaming: false },
      '/c/:id/:cid': { ssr: true, prerender: false, streaming: false }
    },
    cloudflare: {
      // 使用仓库里的 wrangler.toml，避免生成式 deploy config 指向不存在的产物。
      deployConfig: false,
      // 关闭 Nitro 的 unenv hybrid node 兼容：开启时 Nitro 会向生成的
      // dist/_worker.js/wrangler.json 强制写入 `no_nodejs_compat_v2`，
      // 使运行时退回 Node v1，导致 worker 里的 `import "node:buffer"` 报
      // “No such module node:buffer”。改为依赖运行时自带的 nodejs_compat v2
      // （由 wrangler.toml 里较新的 compatibility_date 自动启用）。
      nodeCompat: false,
      pages: {
        routes: {
          include: [
            '/s/*',
            '/b/*',
            '/c/*',
            '/api/content/*',
            '/api/collection/*',
            '/*-reader',
            '/dashboard',
            '/dashboard/**',
            '/_og/d/*',
            '/_og/r/*',
            '/sitemap.xml',
            '/sitemap_index.xml',
            '/__sitemap__/*',
            '/api/__sitemap__/*'
          ]
        }
      }
    }
  },
  turnstile: {
    siteKey: `${envConfig.TURNSTILE_SITE_KEY || ''}`
  },
  experimental: {
    sharedPrerenderData: false,
    ssrStreaming: true
  },
  robots: {
    sitemap: [`/sitemap.xml`],
    groups: [
      {
        allow: [],
        disallow: ['/bookmarks', '/onboarding', '/user', '/login', '/guide', '/auth', '/dashboard']
      }
    ],
    credits: false
  },
  site: {
    enabled: true,
    indexable: profile.indexable,
    url: envConfig.PUBLIC_BASE_URL as string,
    name: 'Slax Reader: Read Smarter, Save Forever'
  },
  sitemap: {
    enabled: true,
    minify: true,
    // 关闭：否则用生成时刻当
    // lastmod，每次请求都变
    autoLastmod: false,
    cacheMaxAgeSeconds: 3600,
    sitemaps: {
      home: {
        // 无可靠变更时间，不造 lastmod
        urls: () => [{ loc: '/' }]
      },
      collection: {
        sources: ['/api/__sitemap__/collections']
      }
    }
  },
  schemaOrg: {
    enabled: true,
    identity: {
      type: 'Organization',
      name: 'Slax Reader',
      logo: `${envConfig.PUBLIC_BASE_URL || ''}/logo.png`,
      url: `${envConfig.PUBLIC_BASE_URL || ''}`,
      sameAs: ['https://x.com/SlaxReader', 'https://t.me/slax_app', 'https://github.com/slax-lab/slax-reader', 'https://x.com/wulujia'],
      contactPoint: [
        {
          email: 'reader@slax.com',
          contactType: 'customer support'
        }
      ]
    }
  },
  ogImage: {
    enabled: true,
    fontSubsets: ['latin', 'chinese-simplified']
  },
  pwa: {
    mode: profile.pwaMode,
    manifest: {
      id: 'com.app.slax_reader',
      name: 'Slax Reader',
      short_name: 'slax-reader',
      description: 'Simple reading, relax thinking',
      theme_color: '#F5F5F3',
      start_url: '/bookmarks',
      display_override: ['fullscreen', 'minimal-ui'],
      icons: [
        {
          src: 'pwaicon@192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: 'pwaicon@512.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ]
    },
    scope: '/',
    // 关闭按 route rules 全局注入 manifest：改由 default 布局里仅在 inbox 渲染 <NuxtPwaAssets/>,
    // 使「安装」入口只出现在 inbox（详情页不暴露 manifest，避免安装后启动页变成详情页）
    registerWebManifestInRouteRules: false,
    srcDir: './service-worker',
    filename: profile.swFilename,
    strategies: 'injectManifest',
    registerType: 'autoUpdate',
    // 通知/推送移除后,SW 不再由 useNotification 手动注册;改由 vite-pwa 自动注册以保留 PWA(离线缓存/可安装)
    injectRegister: 'auto',
    includeManifestIcons: false,
    injectManifest: {
      maximumFileSizeToCacheInBytes: 10000000,
      // WASM 网络加载，避免将 PowerSync 二进制与不同 JS/runtime 版本绑定缓存。
      globPatterns: ['**/*.{ico,png,jpg,jpeg,svg,gif,webp,woff,woff2}'],
      buildPlugins: {
        rollup: [
          replace({
            preventAssignment: true,
            values: {
              'process.env.__DWEB_API_BASE_URL__': `"${envConfig.DWEB_API_BASE_URL}"`
            }
          })
        ]
      }
    },
    devOptions: {
      // 默认关闭以免缓存干扰日常 HMR；调试 PWA 时使用 ENABLE_DEV_SW=true pnpm dev:dweb。
      enabled: enableDevServiceWorker,
      type: 'module'
    }
  },
  hooks: {
    'build:before': () => {
      syncBackendServiceBinding()
    },
    'vite:extendConfig': (config, { isClient }) => {
      // @nuxtjs/mdc 仍生成 pnpm 的 `parent > child` optimizeDeps 语法，Vite 8 无法解析。
      if (isClient && config.optimizeDeps?.include) {
        config.optimizeDeps.include = config.optimizeDeps.include.filter(dep => !dep.startsWith('@nuxtjs/mdc > '))
      }
    }
  },
  scripts: {
    registry: {
      googleTagManager: profile.enableGtm
        ? {
            id: `${envConfig.GTM_CONTAINER_ID || ''}`
          }
        : 'mock'
    }
  },
  compatibilityDate: '2024-09-24'
})
