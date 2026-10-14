<template>
  <!-- 列表工具栏：最近更新时间 + 布局切换器（card / text）。显隐 guard 由父级控制 -->
  <div class="page-toolbar" :class="{ 'has-leading': showLeading }">
    <div class="toolbar-leading">
      <slot v-if="showLeading" name="leading" />
      <p class="page-subtitle" v-else-if="lastUpdatedText">{{ lastUpdatedText }}</p>
    </div>
    <div class="layout-switcher">
      <!-- 文字列表：三条横线 icon -->
      <button class="layout-btn" :class="{ active: listMode === 'text' }" @click="listMode = 'text'" :title="$t('page.bookmarks_index.layout_text')" type="button">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      </button>
      <div class="layout-divider" />
      <!-- 卡片列表：两个横向矩形 icon -->
      <button class="layout-btn" :class="{ active: listMode === 'card' }" @click="listMode = 'card'" :title="$t('page.bookmarks_index.layout_card')" type="button">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="7" rx="2" />
          <rect x="3" y="14" width="18" height="7" rx="2" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  lastUpdatedText: string
  showLeading?: boolean
}>()

// 布局模式：'card'（卡片）| 'text'（紧凑文字），由父级 v-model 持久化
const listMode = defineModel<'card' | 'text'>({ required: true })
</script>

<style lang="scss" scoped>
.page-toolbar {
  --style: flex items-center justify-between mb-16px px-4px;

  // ≤768：隐藏布局切换器
  @media (max-width: 768px) {
    display: none;

    // 移动端保留来源筛选关闭入口
    &.has-leading {
      display: flex;

      .layout-switcher {
        display: none;
      }
    }
  }
}

.toolbar-leading {
  min-width: 0;
}

.page-subtitle {
  font-size: 13px;
  color: var(--slax-text-light);
  font-weight: 300;
  margin: 0;
}

.layout-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
}

.layout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--slax-text-light);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  outline: none;

  &:hover {
    color: var(--slax-text-muted);
  }

  &.active {
    color: var(--slax-text);
  }
}

.layout-divider {
  width: 1px;
  height: 14px;
  background: var(--slax-border);
}
</style>
