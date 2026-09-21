// v-ime-guard 指令注册：实现见 app/directives/imeGuard.ts
// 拆分成两个文件是为了让测试能只 import 纯指令定义，不牵连 defineNuxtPlugin 的模块级执行
import { imeGuard } from '~/directives/imeGuard'

export default defineNuxtPlugin(nuxtApp => {
  nuxtApp.vueApp.directive('ime-guard', imeGuard)
})
