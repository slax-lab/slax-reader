<template>
  <div class="quote-tweet-container">
    <div class="quote-tweet">
      <div class="quote-header">
        <img :src="avatarUrl" :alt="t('component.article_ce_tweet.quote_avatar_alt')" class="quote-avatar" />
        <div class="quote-title">{{ title }}</div>
      </div>
      <div class="quote-description">{{ description }}</div>
      <div class="quote-media">
        <img :src="mediaImageUrl" :alt="t('component.article_ce_tweet.quote_image_alt')" />
      </div>
      <a :href="url" target="_blank" class="quote-link"></a>
    </div>
  </div>
</template>

<script lang="ts" setup>
defineProps({
  avatarUrl: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  mediaImageUrl: {
    type: String,
    default: ''
  },
  url: {
    type: String,
    default: ''
  }
})

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}
</script>

<style lang="scss" scoped>
.quote-tweet-container {
  // #e1e8ed / #f5f8fa 是 Twitter 嵌入引用块的浅蓝灰色板（与 _twitter.scss 同源），保留
  --style: mt-28px relative border-(1px solid #e1e8ed) rounded-8px p-15px;
  --style: 'hover:bg-#f5f8fa transition-colors duration-normal';

  .quote-tweet {
    --style: '!mt-0';

    .quote-header {
      --style: flex items-center;

      img {
        --style: 'w-32px h-32px rounded-full m-0';
      }

      .quote-title {
        --style: 'font-bold !text-(meta txt)';
      }

      img + .quote-title {
        --style: '!ml-10px';
      }
    }

    .quote-description {
      // #555 介于 token text-muted (#6a5f52) 与 text (#1a1814) 之间，保留为 quote 引用色
      --style: mt-10px text-(meta #555);
    }

    .quote-media {
      --style: w-full;

      img {
        --style: max-w-full rounded-8px mt-10px;
      }
    }

    .quote-link {
      --style: absolute inset-0 opacity-0;
    }
  }
}
</style>
