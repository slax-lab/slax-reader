import { isUrl } from '@commons/utils/is'

// 测试 seam：pwa.ts 内的 useNuxtApp().$pwa.isPWAInstalled 在 nuxt-test-utils 下是 configurable: false
// 不可被 defineProperty 替换，且 ESM 同模块 helper 在 vi.mock 后无法改写本地绑定。
// 通过导出 pwaRuntime 对象，pwaOpen 调用 pwaRuntime.getInstalled() 走属性查找；
// 测试用 vi.spyOn(pwaRuntime, 'getInstalled').mockReturnValue(true/false) 替换两条分支。
// 详见 .claude/test-framework/phase3-plan.md §六.2 修订 4。
export const pwaRuntime = {
  getInstalled: () => useNuxtApp().$pwa?.isPWAInstalled
}

export const pwaOpen = (options: { url: string; target?: string }) => {
  if (pwaRuntime.getInstalled()) {
    navigateTo(options.url, { external: isUrl(options.url) })
  } else {
    window.open(options.url, options.target || '_blank')
  }
}
