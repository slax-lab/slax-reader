<template>
  <div class="social-post-footer-info" v-if="metrics.length || redditLink">
    <span v-if="metrics.length">{{ metrics.join('；') }}</span>
    <a v-if="redditLink" class="source-link" :href="redditLink" target="_blank">{{ t('common.operate.view_source') }}</a>
  </div>
</template>

<script lang="ts" setup>
// 只渲染存在的指标，缺省不展示
const props = defineProps({
  platform: {
    type: String,
    required: false
  },
  likeCount: {
    type: String,
    required: false
  },
  commentCount: {
    type: String,
    required: false
  },
  shareCount: {
    type: String,
    required: false
  },
  repostCount: {
    type: String,
    required: false
  },
  score: {
    type: String,
    required: false
  },
  redditLink: {
    type: String,
    required: false
  }
})

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const isPresent = (v?: string) => v !== undefined && v !== null && v !== ''

const metrics = computed(() => {
  const list: string[] = []
  const add = (value: string | undefined, label: string) => {
    if (isPresent(value)) list.push(`${label} ${value}`)
  }

  add(props.commentCount, t('common.operate.comment'))
  add(props.repostCount, t('common.operate.forward'))
  add(props.shareCount, t('common.operate.share'))
  add(props.likeCount, t('common.operate.like'))
  add(props.score, t('component.article_ce_social_post.score'))

  return list
})
</script>

<style lang="scss" scoped>
.social-post-footer-info {
  --style: mt-16px text-(meta txt-light) line-height-20px select-none flex items-center flex-wrap;

  .source-link {
    --style: 'ml-10px text-#5490c2 underline-none decoration-none';
  }
}
</style>
