import type { UserShareCollectInfo } from '@commons/contracts/interface'
import { RESTMethodPath } from '@commons/contracts/const'

// 模块级单例缓存，跨组件复用
const info = ref<UserShareCollectInfo | null>(null)
const loaded = ref(false)
let inflight: Promise<void> | null = null

const fetchInfo = () => {
  inflight ??= request()
    .get<UserShareCollectInfo>({ url: RESTMethodPath.COLLECT_MINE })
    .then(res => {
      info.value = res ?? null
    })
    .catch(() => {
      // 静默：失败保留旧值
    })
    .finally(() => {
      loaded.value = true
      inflight = null
    })
  return inflight
}

export const useShareCollectInfo = () => {
  // SWR：先出缓存，后台静默刷新
  const ensure = () => {
    if (!import.meta.client || !haveRequestToken()) return
    fetchInfo()
  }

  // 状态可能变更后强制刷新
  const refresh = () => {
    if (!import.meta.client || !haveRequestToken()) return
    inflight = null
    return fetchInfo()
  }

  return { info, loaded, ensure, refresh }
}
