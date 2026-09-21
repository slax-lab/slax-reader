<template>
  <div class="panel-operate" ref="panelOperate">
    <button class="menu-dots-button" @click="dotsClick">
      <img src="@/assets/menu-dots.png" />
    </button>

    <Transition name="operates">
      <div class="menus-container" v-show="isShowBubble" v-on-click-outside="outsideClick">
        <div class="menus">
          <button class="subpanel-button" v-for="panel in morePanelItem" :key="panel.type" @click="actionClick(panel)">
            <div class="icon">
              <template v-if="panel.isLoading">
                <div class="i-svg-spinners:90-ring w-16px color-#FFFFFF99"></div>
              </template>
              <template v-else>
                <template v-if="!(panel.isSelected && panel.isSelected()) || !panel.selectedIcon">
                  <img class="normal" :src="panel.icon" alt="" />
                  <img class="highlighted" :src="panel.highlighedIcon" alt="" />
                </template>
                <template v-else>
                  <img class="selected" :src="panel.selectedIcon" alt="" />
                </template>
              </template>
            </div>
            <span>{{ panel.title }}</span>
          </button>
        </div>
        <div class="menus">
          <button class="subpanel-button" v-for="panel in subMorePanelItem" :key="panel.type" @click="actionClick(panel)">
            <div class="icon">
              <template v-if="!(panel.isSelected && panel.isSelected()) || !panel.selectedIcon">
                <img class="normal" :src="panel.icon" alt="" />
                <img class="highlighted" :src="panel.highlighedIcon" alt="" />
              </template>
              <template v-else>
                <img class="selected" :src="panel.selectedIcon" alt="" />
              </template>
            </div>
            <span>{{ panel.title }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { Images, type PanelItem, PanelItemType } from '@/config/panel'

import { vOnClickOutside } from '@vueuse/components'

const props = defineProps({
  isStar: {
    type: Boolean,
    required: false
  },
  isArchive: {
    type: Boolean,
    required: false
  }
})

const morePanelItem = ref<PanelItem[]>([
  {
    type: PanelItemType.Star,
    icon: Images.star.main,
    highlighedIcon: Images.star.highlighted,
    selectedIcon: Images.star.selected,
    title: computed(() => {
      return props.isStar ? $t('component.sidebar.starred') : $t('component.sidebar.star')
    }),
    hovered: false,
    isSelected: () => props.isStar
  },
  {
    type: PanelItemType.Archieve,
    icon: Images.archieve.main,
    highlighedIcon: Images.archieve.highlighted,
    selectedIcon: Images.archieve.selected,
    title: computed(() => {
      return props.isArchive ? $t('component.sidebar.archieved') : $t('component.sidebar.archieve')
    }),
    hovered: false,
    isSelected: () => props.isArchive
  },
  {
    type: PanelItemType.Share,
    icon: Images.share.main,
    highlighedIcon: Images.share.highlighted,
    title: $t('component.sidebar.share'),
    hovered: false
  }
])

const subMorePanelItem = ref<PanelItem[]>([
  {
    type: PanelItemType.Feedback,
    icon: Images.feedback.main,
    highlighedIcon: Images.feedback.highlighted,
    title: $t('component.sidebar.feedback'),
    hovered: false
  }
])

const emits = defineEmits(['action'])

const panelOperate = ref<HTMLDivElement>()
const isShowBubble = ref(false)

const outsideClick = () => {
  isShowBubble.value = false
  clearHandler()
}

const dotsClick = (e: Event) => {
  e.stopPropagation()

  isShowBubble.value = !isShowBubble.value
  !isShowBubble.value && clearHandler()
}

const clearHandler = () => {
  morePanelItem.value.forEach(panel => {
    panel.finishHandler = undefined
  })
}

const actionClick = (panel: PanelItem) => {
  if ([PanelItemType.Star, PanelItemType.Archieve].includes(panel.type)) {
    panel.finishHandler = () => {
      isShowBubble.value = false
    }
  } else {
    isShowBubble.value = false
  }

  emits('action', panel)
}
</script>

<style lang="scss" scoped>
.panel-operate {
  --style: relative;

  .menu-dots-button {
    --style: w-18px h-auto flex-center box-content p-5px rounded-5px;
    --style: 'hover:(bg-#262626) active:(scale-130) transition-all duration-250';

    img {
      --style: w-full select-none;
    }
  }

  .menus-container {
    --style: z-1 absolute bottom-0 right-full mr-13px min-w-160px bg-#1f1f1f px-8px flex flex-col rounded-8px border-(1px solid #ffffff0a);

    .menus {
      --style: flex flex-col w-full relative;

      button.subpanel-button {
        --style: flex items-center h-32px px-8px overflow-hidden whitespace-nowrap text-ellipsis rounded-6px transition-all duration-250;
        --style: 'text-#ffffff99 hover:(bg-#00000029 text-#ffffffe6)';

        .icon {
          --style: relative size-16px;
          img {
            --style: absolute size-full left-1/2 top-1/2 -translate-1/2 transition-opacity duration-250 object-contain select-none;
          }

          .normal {
            --style: opacity-100;
          }

          .highlighted {
            --style: opacity-0;
          }
        }

        span {
          --style: ml-8px text-(13px) line-height-18px transition-all duration-250;
        }

        &:hover {
          .icon {
            .normal {
              --style: opacity-0;
            }

            .highlighted {
              --style: opacity-100;
            }
          }
        }
      }

      &:not(:first-child) {
        &::before {
          --style: absolute top-0 left-8px right-8px h-1px bg-#FFFFFF0A content-empty;
        }
      }

      &:nth-child(1) {
        --style: py-7px;
      }

      &:nth-child(2) {
        --style: py-4px;

        button.subpanel-button {
          --style: py-6px h-30px;
          --style: 'text-#FFFFFF66 hover:(text-#ffffffe6)';
        }
      }
    }
  }
}

.operates-leave-to,
.operates-enter-from {
  --style: 'opacity-0';
}

.operates-enter-active,
.operates-leave-active {
  --style: transition-all duration-250 ease-in-out;
}
</style>
