export const isLocalFirstEnabled = (): boolean => import.meta.client && !!useNuxtApp().$powersync

// TEMP: 同步规则缺 user_id，highlights 暂走 REST
// 第 3 步修好后返回 true 即恢复
export const isHighlightLocalFirstEnabled = (): boolean => false
