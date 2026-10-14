// 首页左侧栏折叠状态：模块级单例，顶栏按钮与侧栏共享，持久化到 localStorage
// 沿用 useListLayoutMode 的 ref + watch + 手动 localStorage 写法（含 SSR 守卫）
// 初始值在首次调用时才读 localStorage，避免模块加载期访问 storage
import { ref, watch } from 'vue'

const STORAGE_KEY = 'slax-sidebar-collapsed'

const collapsed = ref(false)
let restored = false

watch(collapsed, value => {
  if (import.meta.client) {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  }
})

export const useSidebarCollapsed = () => {
  if (!restored && import.meta.client) {
    restored = true
    collapsed.value = localStorage.getItem(STORAGE_KEY) === '1'
  }

  const toggle = () => {
    collapsed.value = !collapsed.value
  }

  return { collapsed, toggle }
}
