<template>
  <div class="subscribe-placeholder dark">
    <div class="header" v-if="placeholderStyle === PlaceholderStyle.Summary">
      <div class="title">{{ bookmarkBriefInfo.title }}</div>
    </div>
    <div class="loading" :class="{ 'mt-32px': placeholderStyle === PlaceholderStyle.Summary, 'mt-10px': placeholderStyle === PlaceholderStyle.Chat }">
      <div class="placeholder">
        <div class="row" v-for="(_, index) in Array.from({ length: 3 })" :key="index"></div>
      </div>
    </div>
    <div class="tags" v-if="placeholderStyle === PlaceholderStyle.Summary">
      <BookmarkTags :bookmark-id="bookmarkUid ? 1 : undefined" :tags="tags" />
    </div>
    <div class="subscribe" :class="{ 'mt-40px': placeholderStyle === PlaceholderStyle.Summary, 'mt-120px': placeholderStyle === PlaceholderStyle.Chat }">
      <SubscribeCard />
    </div>
  </div>
</template>

<script lang="ts">
export enum PlaceholderStyle {
  Summary = 'summary',
  Chat = 'chat'
}
</script>

<script lang="ts" setup>
import SubscribeCard from './SubscribeCard.vue'
import BookmarkTags from '@/components/BookmarkTags.vue'

import type { BookmarkBriefDetail, BookmarkTag } from '@commons/frontend-types/models'

type ExtensionBookmarkBriefInfo = BookmarkBriefDetail

const props = defineProps({
  placeholderStyle: {
    type: String as PropType<PlaceholderStyle>,
    required: true
  },
  bookmarkBriefInfo: {
    type: Object as PropType<ExtensionBookmarkBriefInfo>,
    required: true
  },
  bookmarkUid: {
    type: String,
    required: false
  }
})

const tags = ref<BookmarkTag[]>(props.bookmarkBriefInfo.tags)
const bookmarkUid = computed(() => props.bookmarkUid || props.bookmarkBriefInfo.bookmark_user_uuid)
</script>

<style lang="scss" scoped>
.subscribe-placeholder {
  --style: px-20px py-30px;

  .header {
    .title {
      --style: text-(20px #ffffffe6) font-semibold line-height-28px;
    }
  }

  .loading {
    --style: select-none;

    .placeholder {
      --style: w-full flex flex-col;

      .row {
        --style: w-full h-16px rounded-1 animate-pulse bg-gradient-to-r from-#ffffff0f to-#ffffff11;
        --style: 'not-first:mt-10px';
      }
    }
  }

  .tags {
    --style: mt-24px;
  }

  .subscribe {
    --style: w-full flex-center;
  }
}
</style>
