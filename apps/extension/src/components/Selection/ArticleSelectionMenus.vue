<template>
  <Transition name="opacity" @after-leave="onAfterLeave">
    <div class="dark" v-show="appear">
      <div class="article-selection-menus" v-on-click-outside="handleClickOutside">
        <button class="menu" v-for="menu in menus" :key="menu.id" @click="e => handleClick(menu.id, e)">
          <img :src="menu.icon" />
          <span>{{ menu.name }}</span>
        </button>
      </div>
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import menuChatbotImage from '@/assets/menu-chatbot-icon.png'
import menuCommentImage from '@/assets/menu-comment-icon.png'
import menuCopyImage from '@/assets/menu-copy-icon.png'
import menuStrokeDeleteImage from '@/assets/menu-stroke-delete-icon.png'
import menuStrokeImage from '@/assets/menu-stroke-icon.png'

import { MenuType } from './type'
import { vOnClickOutside } from '@vueuse/components'

interface MenuItem {
  id: MenuType
  name: string
  icon: string
}

const props = defineProps({
  allowAction: {
    type: Boolean,
    default: false
  },
  isStroked: {
    type: Boolean,
    default: false
  }
})
const emits = defineEmits(['action', 'dismiss', 'noAction'])
const menus = ref<MenuItem[]>([])
const appear = ref(false)

const updateMenus = () => {
  menus.value = [
    {
      id: MenuType.Copy,
      name: $t('common.operate.copy'),
      icon: menuCopyImage
    }
  ]
  if (props.allowAction) {
    menus.value.push(
      ...[
        props.isStroked
          ? {
              id: MenuType.Stroke_Delete,
              name: $t('common.operate.delete_line'),
              icon: menuStrokeDeleteImage
            }
          : {
              id: MenuType.Stroke,
              name: $t('common.operate.line'),
              icon: menuStrokeImage
            },
        {
          id: MenuType.Comment,
          name: $t('common.operate.comment'),
          icon: menuCommentImage
        }
      ]
    )
  }

  menus.value.push({
    id: MenuType.Chatbot,
    name: $t('common.operate.chatbot'),
    icon: menuChatbotImage
  })
}

nextTick(() => {
  appear.value = true
})

const handleClick = (id: MenuType, event: MouseEvent) => {
  // if (id !== MenuType.Copy && !useUserStore().userInfo) {
  //   return showLoginModal({
  //     redirect: window.location.href
  //   })
  // }
  emits('action', id, event)
  appear.value = false
}

const handleClickOutside = () => {
  emits('noAction')
  appear.value = false
}

watch(
  () => props.allowAction,
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
.article-selection-menus {
  --style: p-4px shadow-[0px_20px_40px_0px_#00000029] rounded-8px border-(1px solid #a8b1cd33) inline-flex items-center;
  --style: 'bg-#fff dark:bg-#262626';

  .menu {
    --style: px-12px py-8px rounded-6px whitespace-nowrap cursor-pointer flex items-center transition-all duration-250;
    --style: 'text-#999  active:(scale-105)';

    &:hover {
      --style: 'bg-#f5f5f3 dark:(bg-#00000029 text-#ffffff)';
    }

    img {
      --style: w-24px h-24px object-fit;
    }

    span {
      --style: ml-2px text-13px line-height-18px shrink-0 whitespace-nowrap transition-colors duration-250;
    }
  }
}
</style>
