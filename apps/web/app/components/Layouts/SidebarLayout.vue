<template>
  <div class="sidebar" :class="{ animated }">
    <Transition name="opacity">
      <div class="sidebar-bg-mask" v-show="show" @click.prevent="show = false"></div>
    </Transition>
    <div class="sidebar-container" ref="sidebarContent" :class="{ expanded: show }" :style="width ? { width } : {}">
      <div class="sidebar-content">
        <slot />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
defineProps({
  width: {
    type: String,
    required: false
  },
  animated: {
    type: Boolean,
    required: false
  }
})

const show = defineModel('show')
const sidebarContent = ref<HTMLDivElement>()

const contentWidth = () => {
  return sidebarContent.value?.getBoundingClientRect().width
}

defineExpose({
  contentWidth
})
</script>

<style lang="scss" scoped>
.sidebar {
  --style: 'fixed max-md:(left-0 top-full w-full) print:hidden md:(left-full top-0 h-full) ';

  &.animated {
    --style: transition-right duration-200;

    .sidebar-container {
      --style: transition-transform duration-200;
    }
  }

  .sidebar-bg-mask {
    --style: 'max-md:(fixed inset-0 z-9 bg-black bg-opacity-50) md:(hidden)';
  }

  .sidebar-container {
    // #a8b1cd33 蓝灰半透分隔线 + bg-#f5f5f3 浅米白侧栏底色，保留
    --style: 'relative z-10 max-md:(pb-10 !w-full h-80vh border-t-(1px solid #a8b1cd33)) md:(h-full border-l-(1px solid #a8b1cd33) shadow-[-20px_0px_40px_0px_#0000000a]) bg-#f5f5f3 overflow-auto box-content';

    &.expanded {
      --style: 'max-md:(-translate-y-full) md:(-translate-x-full)';
    }

    .sidebar-content {
      --style: 'p-20px h-full max-md:(overflow-hidden) md:(overflow-auto)';

      & > * {
        --style: 'max-md:(min-h-auto h-full overflow-y-auto)';
      }
    }
  }
}
</style>
