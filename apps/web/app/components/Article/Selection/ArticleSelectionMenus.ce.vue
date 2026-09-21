<template>
  <Transition name="opacity" @after-leave="onAfterLeave">
    <div :class="{ dark: dark }" v-show="appear">
      <div
        class="article-selection-menus"
        v-click-outside="{
          handler: handleClickOutside,
          exclude: () => [articleSelectionMenus]
        }"
        ref="articleSelectionMenus"
      >
        <template v-for="(menu, index) in menus" :key="menu.id">
          <span v-if="index > 0" class="menu-divider" aria-hidden="true"></span>
          <button class="menu" @click="e => handleClick(menu.id, e)">
            <span class="menu-icon" v-html="menu.icon"></span>
            <span class="menu-label">{{ menu.name }}</span>
          </button>
        </template>
      </div>
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import { ClickOutside } from '@commons/utils/directive'

import { MenuType } from './type'
import { showLoginModal } from '~/components/Modal'
import { useUserStore } from '~/stores/user'
interface MenuItem {
  id: MenuType
  name: string
  icon: string
}

// 内联 SVG 图标（对齐 slax-reader-design-prototypes 的 .selection-tool）。
// 全部用 currentColor，颜色跟随按钮 color，无需再维护 light/dark 两套位图。
const ICON_COPY = `<svg viewBox="0 0 16 16" fill="none" stroke-width="1" fill-rule="evenodd"><g transform="translate(2, 2)" stroke="currentColor"><path d="M5.00000004,3.66666667 L9.99999996,3.66666667 C10.7363796,3.66666667 11.3333333,4.26362035 11.3333333,5.00000004 L11.3333333,9.99999996 C11.3333333,10.7363796 10.7363796,11.3333333 9.99999996,11.3333333 L5.00000004,11.3333333 C4.26362035,11.3333333 3.66666667,10.7363796 3.66666667,9.99999996 L3.66666667,5.00000004 C3.66666667,4.26362035 4.26362035,3.66666667 5.00000004,3.66666667 Z"/><path d="M2,7.66666667 L1.33333333,7.66666667 C0.596953667,7.66666667 0,7.069713 0,6.33333333 L0,1.33333333 C0,0.596953667 0.596953667,0 1.33333333,0 L6.33333333,0 C7.069713,0 7.66666667,0.596953667 7.66666667,1.33333333 L7.66666667,2"/></g></svg>`
const ICON_STROKE = `<svg viewBox="0 0 16 16" fill="none" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(2.75, 2.3333)" stroke="currentColor"><polyline points="1 8.66666667 4.33333333 0 5.66666667 0 9 8.66666667"/><line x1="2.33333333" y1="6" x2="7.66666667" y2="6"/><line x1="0" y1="10.6666667" x2="10.25" y2="10.6666667"/></g></svg>`
const ICON_COMMENT = `<svg viewBox="0 0 16 16" fill="none" stroke-width="1" stroke-linejoin="round"><g transform="translate(2.9167, 3.5)" stroke="currentColor"><path d="M0,0 L9.66666667,0 C10.0348565,0 10.3333333,0.298476833 10.3333333,0.666666667 L10.3333333,7.33333333 C10.3333333,7.70152317 10.0348565,8 9.66666667,8 L2.33333333,8 L0,9.66666667 L0,0 Z"/></g></svg>`
const ICON_CHATBOT = `<svg viewBox="0 0 16 16" fill="none" stroke-width="1"><g transform="translate(2, 2)"><circle stroke="currentColor" cx="6" cy="6" r="6"/><path d="M3.4537925,3.46536973 C3.72993487,3.46536973 3.9537925,3.68922736 3.9537925,3.96536973 L3.9537925,6.25 C3.9537925,6.52614237 3.72993487,6.75 3.4537925,6.75 C3.17765012,6.75 2.9537925,6.52614237 2.9537925,6.25 L2.9537925,3.96536973 C2.9537925,3.68922736 3.17765012,3.46536973 3.4537925,3.46536973 Z" fill="currentColor"/><path d="M7,3.46536973 C7.27614237,3.46536973 7.5,3.68922736 7.5,3.96536973 L7.5,6.25 C7.5,6.52614237 7.27614237,6.75 7,6.75 C6.72385763,6.75 6.5,6.52614237 6.5,6.25 L6.5,3.96536973 C6.5,3.68922736 6.72385763,3.46536973 7,3.46536973 Z" fill="currentColor"/><path d="M11.2830533,8.75 C11.1033171,9.04743188 11,9.39544906 11,9.76738745 C11,10.8623541 11.8954305,11.75 13,11.75" stroke="currentColor"/></g></svg>`

const props = defineProps({
  allowAction: {
    type: Boolean,
    required: false
  },
  // chat 入口开关，默认开
  allowChatbot: {
    type: Boolean,
    required: false,
    default: true
  },
  dark: {
    type: Boolean,
    required: false
  },
  // 选区正好命中一条已有划线时为 true：把「划线」项替换为「删除划线」(Stroke_Delete)
  isStroked: {
    type: Boolean,
    required: false
  },
  // 本人已评论该划线时隐藏「评论」项
  hideComment: {
    type: Boolean,
    required: false
  }
})
const emits = defineEmits(['action', 'dismiss', 'noAction'])

const vClickOutside = ClickOutside
const articleSelectionMenus = useTemplateRef('articleSelectionMenus')
const menus = ref<MenuItem[]>([])
const appear = ref(false)

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const updateMenus = () => {
  menus.value = [
    {
      id: MenuType.Copy,
      name: t('common.operate.copy'),
      icon: ICON_COPY
    }
  ]
  if (props.allowAction) {
    menus.value.push(
      props.isStroked
        ? {
            id: MenuType.Stroke_Delete,
            name: t('common.operate.delete_line'),
            icon: ICON_STROKE
          }
        : {
            id: MenuType.Stroke,
            name: t('common.operate.line'),
            icon: ICON_STROKE
          }
    )
    // 本人未评论过才显「评论」
    if (!props.hideComment) {
      menus.value.push({
        id: MenuType.Comment,
        name: t('common.operate.comment'),
        icon: ICON_COMMENT
      })
    }
  }

  if (props.allowChatbot) {
    menus.value.push({
      id: MenuType.Chatbot,
      name: t('common.operate.chatbot'),
      icon: ICON_CHATBOT
    })
  }
}

nextTick(() => {
  appear.value = true
})

const handleClick = (id: MenuType, event: MouseEvent) => {
  if (id !== MenuType.Copy && !useUserStore().userInfo) {
    return showLoginModal({
      redirect: window.location.href
    })
  }
  emits('action', id, event)
  appear.value = false
}

const handleClickOutside = () => {
  emits('noAction')
  appear.value = false
}

watch(
  () => [props.allowAction, props.allowChatbot, props.isStroked, props.hideComment],
  () => {
    updateMenus()
  },
  { immediate: true }
)

const onAfterLeave = () => {
  emits('dismiss')
}

onUnmounted(() => {})
</script>

<style lang="scss" scoped>
@use '~~/styles/global.scss' as *;

// 本组件消费的 token（dark prop override 需全覆盖）：
//   --slax-surface-solid, --slax-border, --slax-text, --slax-accent, --slax-accent-bg
// 对齐 snapshot demo 的 .selection-tool：白底 + 细分隔线 + hover 反绿。

.article-selection-menus {
  display: inline-flex;
  align-items: stretch;
  padding: 4px 2px;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  box-shadow: 0 6px 20px color-mix(in srgb, var(--slax-text) 12%, transparent);

  .menu {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--slax-text);
    font-size: 12px;
    line-height: 18px;
    white-space: nowrap;
    cursor: pointer;
    transition: all var(--slax-dur-fast, 0.15s) ease;

    &:hover {
      color: var(--slax-accent);
      background: var(--slax-accent-bg);
    }

    &:active {
      transform: scale(1.05);
    }

    .menu-icon {
      display: inline-flex;
      flex-shrink: 0;

      // v-html 注入的 SVG 不带 scoped 属性，须用 :deep 命中
      :deep(svg) {
        display: block;
        width: 16px;
        height: 16px;
      }
    }

    .menu-label {
      flex-shrink: 0;
    }
  }

  .menu-divider {
    width: 1px;
    margin: 4px 0;
    background: var(--slax-border);
    flex-shrink: 0;
  }
}

// dark prop：iframe 浮层场景强制深色（与全站主题正交，宿主原网页可能浅色也可能深色）。
// 覆盖本组件 scoped 内消费的全部 token；CSS 自定义属性默认 inherit，子元素自动拿到 override。
.dark {
  --slax-surface-solid: #1e1b18;
  --slax-border: rgba(168, 177, 205, 0.2);
  --slax-text: #e8e2d9;
  --slax-accent-bg: rgba(22, 185, 152, 0.16);
}
</style>
