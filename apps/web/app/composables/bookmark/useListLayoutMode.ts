// 列表布局模式（card / text）持久化到 localStorage
// 保留原 ref + watch + 手动 localStorage 写法（含 SSR 守卫），不替换为 VueUse useLocalStorage
import { ref, watch } from 'vue'

const STORAGE_KEY = 'slax-list-mode'

export type ListMode = 'card' | 'text'

export const useListLayoutMode = () => {
  // SSR 守卫：服务端无 localStorage，默认 'card'；客户端读取持久化值
  const listMode = ref<ListMode>(import.meta.client ? (localStorage.getItem(STORAGE_KEY) as ListMode) || 'card' : 'card')

  watch(listMode, value => {
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, value)
    }
  })

  return { listMode }
}
