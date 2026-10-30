/// <reference types="vite-plugin-pwa/client" />

import '@slax-reader/contracts'

declare global {
  // 由 nuxt.config.ts 的 vite.define 注入的构建期常量（见 app/app.config.ts）
  const __SLAX_LCP_ARTICLE_IMAGE_PRIORITY__: boolean
  const __SLAX_LCP_ANONYMOUS_PUBLIC_STARTUP__: boolean
}

// It is always important to ensure you import/export something when augmenting a type
export {}
