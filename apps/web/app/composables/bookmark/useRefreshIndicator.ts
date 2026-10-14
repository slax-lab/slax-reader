// 刷新指示器：首屏加载（page===1）时延迟 250ms 再展示顶部 spinner，
// 避免快速加载时 spinner 一闪而过。加载结束立即清除定时器并隐藏。
import { onUnmounted, type Ref, ref, watch } from 'vue'

export const useRefreshIndicator = (isRefreshLoading: Ref<boolean>) => {
  const showRefreshLoading = ref(false)
  let refreshInterval: ReturnType<typeof setTimeout> | undefined

  watch(isRefreshLoading, value => {
    if (value) {
      refreshInterval = setTimeout(() => {
        showRefreshLoading.value = true
      }, 250)
    } else {
      refreshInterval && clearTimeout(refreshInterval)
      showRefreshLoading.value = false
    }
  })

  onUnmounted(() => {
    refreshInterval && clearTimeout(refreshInterval)
  })

  return { showRefreshLoading }
}
