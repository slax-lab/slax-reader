<template>
  <Transition name="opacity">
    <div class="sidebar-items" v-show="!dismissItems">
      <!-- strip 工具条 -->
      <div class="strip" :class="{ hidden: isPanelVisible }">
        <div class="strip-item" @click="onStripItemClick(PanelItemType.Outline)">
          <div class="strip-icon">
            <img :src="Images.outline.main" alt="" />
            <img class="hovered" :src="Images.outline.highlighted" alt="" />
          </div>
          <div class="popup"><span>Outline</span></div>
        </div>

        <div class="strip-sep" />

        <div class="strip-item" @click="onStripItemClick(PanelItemType.Star)">
          <div class="strip-icon">
            <template v-if="!isStar">
              <img :src="Images.star.main" alt="" />
              <img class="hovered" :src="Images.star.highlighted" alt="" />
            </template>
            <template v-else>
              <img :src="Images.star.selected" alt="" />
              <img class="hovered" :src="Images.star.selected" alt="" />
            </template>
          </div>
          <div class="popup">
            <span>{{ isStar ? $t('component.sidebar.starred') : $t('component.sidebar.star') }}</span>
          </div>
        </div>

        <div class="strip-sep" />

        <div class="strip-item" @click="onStripItemClick(PanelItemType.Archieve)">
          <div class="strip-icon">
            <template v-if="!isArchive">
              <img :src="Images.archieve.main" alt="" />
              <img class="hovered" :src="Images.archieve.highlighted" alt="" />
            </template>
            <template v-else>
              <img :src="Images.archieve.selected" alt="" />
              <img class="hovered" :src="Images.archieve.selected" alt="" />
            </template>
          </div>
          <div class="popup">
            <span>{{ isArchive ? $t('component.sidebar.archieved') : $t('component.sidebar.archieve') }}</span>
          </div>
        </div>

        <div class="strip-sep" />

        <div class="strip-item" @click.stop="openMorePanel()">
          <div class="strip-icon more-icon">
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 36L12 24L24 12" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M36 36L24 24L36 12" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <div class="popup">
            <span>{{ $t('component.sidebar.more') }}</span>
          </div>
        </div>
      </div>

      <!-- 更多面板 -->
      <div class="more-panel" :class="{ visible: isPanelVisible }" v-on-click-outside="closePanelOutside">
        <div class="panel-header">
          <div class="brand">
            <div class="brand-logo">
              <img src="@/assets/tiny-app-logo-gray.png" alt="" />
            </div>
            <span>Slax Reader</span>
          </div>
          <button class="collapse-btn" @click="closeMorePanel" :title="$t('component.sidebar.more')">
            <img src="@/assets/tiny-arrow-right-icon.png" alt="" />
          </button>
        </div>

        <div class="panel-grid">
          <div class="panel-btn" @click="onPanelBtnClick(PanelItemType.Outline, 'outline')">
            <div class="icon-badge">
              <img :src="Images.outline.main" alt="" />
              <img class="diamond" src="@/assets/tiny-diamond-icon.png" alt="" />
            </div>
            <span>Outline</span>
          </div>
          <div class="panel-btn" @click="onPanelBtnClick(PanelItemType.Star, 'star')">
            <img :src="isStar ? Images.star.selected : Images.star.main" alt="" />
            <span>{{ isStar ? $t('component.sidebar.starred') : $t('component.sidebar.star') }}</span>
          </div>
          <div class="panel-btn" @click="onPanelBtnClick(PanelItemType.Archieve, 'archive')">
            <img :src="isArchive ? Images.archieve.selected : Images.archieve.main" alt="" />
            <span>{{ isArchive ? $t('component.sidebar.archieved') : $t('component.sidebar.archieve') }}</span>
          </div>
          <div class="panel-btn" @click="onPanelBtnClick(PanelItemType.Share, 'share')">
            <img :src="Images.share.main" alt="" />
            <span>{{ $t('component.sidebar.share') }}</span>
          </div>

          <div class="panel-divider" />

          <div class="panel-btn" @click="onPanelBtnClick(PanelItemType.Chat, 'chat')">
            <div class="icon-badge">
              <img :src="Images.chatbot.main" alt="" />
              <img class="diamond" src="@/assets/tiny-diamond-icon.png" alt="" />
            </div>
            <span>{{ $t('component.sidebar.chat') }}</span>
          </div>
          <div class="panel-btn" @click="onPanelBtnClick(PanelItemType.Comments, 'comment')">
            <img :src="Images.comments.main" alt="" />
            <span>{{ $t('component.sidebar.comments') }}</span>
          </div>
          <div class="panel-btn" @click="onPanelBtnClick(PanelItemType.Feedback, 'feedback')">
            <img :src="Images.feedback.main" alt="" />
            <span>{{ $t('component.sidebar.feedback') }}</span>
          </div>
        </div>
      </div>

      <div class="close-wrapper" v-show="!isPanelVisible">
        <button @click="onDismiss">
          <img src="@/assets/button-tiny-close-white.png" alt="" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import { Images, type PanelItem, PanelItemType } from '@/config/panel'

import { vOnClickOutside } from '@vueuse/components'

const props = defineProps({
  isSummaryShowing: {
    type: Boolean,
    required: false
  },
  isChatbotShowing: {
    type: Boolean,
    required: false
  },
  isCommentShowing: {
    type: Boolean,
    required: false
  },
  isStar: {
    type: Boolean,
    required: false
  },
  isArchive: {
    type: Boolean,
    required: false
  }
})

const emits = defineEmits(['panel-item-action', 'more-panel-open', 'more-panel-close', 'dismiss'])

const dismissItems = ref(false)
const isPanelVisible = ref(false)
const activePanelItem = ref<string | null>(null)

/** 构建 PanelItem 对象并触发事件 */
const buildPanelItem = (type: PanelItemType): PanelItem => {
  switch (type) {
    case PanelItemType.AI:
      return {
        type: PanelItemType.AI,
        icon: Images.ai.main,
        highlighedIcon: Images.ai.highlighted,
        selectedIcon: Images.ai.selected,
        title: $t('component.sidebar.ai'),
        hovered: false,
        isSelected: () => props.isSummaryShowing
      }
    case PanelItemType.Outline:
      return {
        type: PanelItemType.Outline,
        icon: Images.outline.main,
        highlighedIcon: Images.outline.highlighted,
        selectedIcon: Images.outline.selected,
        title: 'Outline',
        hovered: false,
        isSelected: () => props.isSummaryShowing
      }
    case PanelItemType.Chat:
      return {
        type: PanelItemType.Chat,
        icon: Images.chatbot.main,
        highlighedIcon: Images.chatbot.highlighted,
        selectedIcon: Images.chatbot.selected,
        title: $t('component.sidebar.chat'),
        hovered: false,
        isSelected: () => props.isChatbotShowing
      }
    case PanelItemType.Comments:
      return {
        type: PanelItemType.Comments,
        icon: Images.comments.main,
        highlighedIcon: Images.comments.highlighted,
        selectedIcon: Images.comments.selected,
        title: $t('component.sidebar.comments'),
        hovered: false,
        isSelected: () => props.isCommentShowing
      }
    case PanelItemType.Star:
      return {
        type: PanelItemType.Star,
        icon: Images.star.main,
        highlighedIcon: Images.star.highlighted,
        selectedIcon: Images.star.selected,
        title: props.isStar ? $t('component.sidebar.starred') : $t('component.sidebar.star'),
        hovered: false,
        isSelected: () => props.isStar
      }
    case PanelItemType.Archieve:
      return {
        type: PanelItemType.Archieve,
        icon: Images.archieve.main,
        highlighedIcon: Images.archieve.highlighted,
        selectedIcon: Images.archieve.selected,
        title: props.isArchive ? $t('component.sidebar.archieved') : $t('component.sidebar.archieve'),
        hovered: false,
        isSelected: () => props.isArchive
      }
    case PanelItemType.Share:
      return {
        type: PanelItemType.Share,
        icon: Images.share.main,
        highlighedIcon: Images.share.highlighted,
        title: $t('component.sidebar.share'),
        hovered: false
      }
    case PanelItemType.Feedback:
      return {
        type: PanelItemType.Feedback,
        icon: Images.feedback.main,
        highlighedIcon: Images.feedback.highlighted,
        title: $t('component.sidebar.feedback'),
        hovered: false
      }
  }
}

/** strip 按钮点击：Outline / Star / Archive */
const onStripItemClick = (type: PanelItemType) => {
  const panel = buildPanelItem(type)

  if (type === PanelItemType.Outline) {
    // Outline 点击时打开面板并高亮
    isPanelVisible.value = true
    activePanelItem.value = 'outline'
  }

  emits('panel-item-action', panel)
}

/** 展开更多面板 */
const openMorePanel = () => {
  isPanelVisible.value = true
  activePanelItem.value = null
  emits('more-panel-open')
}

/** 关闭更多面板 */
const closeMorePanel = () => {
  isPanelVisible.value = false
  activePanelItem.value = null
  emits('more-panel-close')
}

/** 点击面板外部关闭 */
const closePanelOutside = () => {
  if (isPanelVisible.value) {
    closeMorePanel()
  }
}

const onDismiss = () => {
  dismissItems.value = true
  emits('dismiss')
}

/** 面板内按钮点击 */
const onPanelBtnClick = (type: PanelItemType, name: string) => {
  const panel = buildPanelItem(type)

  // 设置激活状态（Star 和 Archive 通过 props 状态体现，无需额外激活）
  if (![PanelItemType.Star, PanelItemType.Archieve].includes(type)) {
    activePanelItem.value = name
  }

  closeMorePanel()

  emits('panel-item-action', panel)
}
</script>

<style lang="scss" scoped>
.sidebar-items {
  --style: relative z-2 cursor-default;

  /* ═══════ STRIP 收起状态工具条 ═══════ */
  .strip {
    --style: bg-#1c1c1e rounded-(lt-14px lb-14px) py-8px px-5px flex flex-col gap-2px transition-all duration-250 ease;

    &.hidden {
      --style: opacity-0 pointer-events-none translate-x-full;
    }

    .strip-item {
      --style: relative size-44px flex items-center justify-center rounded-10px cursor-pointer;

      .strip-icon {
        --style: relative size-22px shrink-0 z-1 select-none;

        img {
          --style: absolute inset-0 size-full object-contain select-none transition-opacity duration-180;

          &:first-child {
            --style: opacity-100;
          }

          &.hovered {
            --style: opacity-0;
          }
        }

        &.more-icon {
          svg {
            --style: size-full color-#888 transition-colors duration-180;
          }
        }
      }

      &:hover {
        .strip-icon {
          img:first-child {
            --style: opacity-0;
          }

          img.hovered {
            --style: opacity-100;
          }

          &.more-icon svg {
            --style: color-#fff;
          }
        }
      }

      /* hover 时从右侧弹出的文字标签 */
      .popup {
        --style: absolute right-full h-full flex items-center whitespace-nowrap pointer-events-none bg-#1c1c1e rounded-l-10px shadow-[-4px_0_16px_#00000073] pt-0 pr-12px pb-0
          pl-14px opacity-0 translate-x-full;
        transition:
          transform 0.2s ease,
          opacity 0.15s ease;

        span {
          --style: text-(13.5px #fff) font-500;
        }
      }

      &:hover .popup {
        --style: opacity-100 pointer-events-auto translate-x-0;
        transition:
          transform 0.42s cubic-bezier(0.34, 1.12, 0.64, 1),
          opacity 0.2s ease 0.05s;
      }
    }

    .strip-sep {
      --style: self-center h-1px w-24px bg-#ffffff14;
    }
  }

  /* ═══════ MORE PANEL 展开面板 ═══════ */
  .more-panel {
    --style: absolute right-0 top-1/2 bg-#1c1c1e rounded-18px px-16px py-13px z-10 pointer-events-none opacity-0 shadow-[-6px_6px_28px_#00000073];
    transform: translateY(-50%) translateX(100%);
    transition:
      opacity 0.25s ease,
      transform 0.38s cubic-bezier(0.34, 1.08, 0.64, 1);

    &.visible {
      --style: pointer-events-auto opacity-100;
      transform: translateY(-50%) translateX(-14px);
    }

    .panel-header {
      --style: flex items-center justify-between mb-13px;

      .brand {
        --style: flex items-center gap-8px text-(14.5px #ffffff66) font-500 tracking-[0.01em];

        .brand-logo {
          --style: size-26px rounded-7px flex items-center justify-center shrink-0 overflow-hidden;

          img {
            --style: size-18px object-contain;
          }
        }
      }

      .collapse-btn {
        --style: size-30px rounded-8px flex items-center justify-center shrink-0 cursor-pointer border-(1px solid #333) bg-transparent transition-all duration-180;

        img {
          --style: size-16px object-contain select-none;
        }

        &:hover {
          --style: border-#555 bg-#2c2c2e;
        }
      }
    }

    .panel-grid {
      --style: grid gap-7px;
      grid-template-columns: repeat(4, 60px);

      .panel-divider {
        --style: col-span-full h-1px bg-#2a2a2c my-4px;
      }

      .panel-btn {
        --style: flex flex-col items-center justify-center gap-6px cursor-pointer select-none w-full pt-8px px-0 pb-7px rounded-12px text-(11.5px #888) font-500 transition-all
          duration-180;

        img {
          --style: size-23px object-contain;
        }

        .icon-badge {
          --style: relative;

          img {
            --style: size-23px object-contain;
          }

          .diamond {
            --style: absolute pointer-events-none w-8px h-7px -top-5px -right-5px;
          }
        }

        &:hover {
          --style: bg-#2c2c2e text-#ddd;
        }
      }
    }
  }

  /* ═══════ 关闭按钮 ═══════ */
  .close-wrapper {
    --style: absolute bottom-full right-0;

    button {
      --style: size-16px bg-#2626264f rounded-lt-4px flex-center transition-colors duration-250;
      --style: 'hover:bg-#2626268f';
      img {
        --style: size-8px object-contain select-none;
      }
    }
  }
}
</style>
