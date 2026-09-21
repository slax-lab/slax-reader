<template>
  <div class="tweet-user-info">
    <div class="base-info">
      <img class="avatar" :src="avatar" alt="" />
      <div class="name">
        <span class="username">{{ name }}</span>
        <span class="screen-name">{{ screenName }}</span>
      </div>
    </div>
    <div class="follow-info">
      <div class="followers">
        <span>{{ followers }}</span>
        <span>{{ t('component.article_ce_tweet.followers') }}</span>
      </div>
      <i class="seperator"></i>
      <div class="followings">
        <span>{{ followings }}</span>
        <span>{{ t('component.article_ce_tweet.followings') }}</span>
      </div>
    </div>
    <div class="optional-info">
      <div class="optional-item" v-if="location">
        <span>{{ t('component.article_ce_tweet.location') }}</span>
        <span>{{ location }}</span>
      </div>
      <div class="optional-item" v-if="website">
        <span>{{ t('component.article_ce_tweet.website') }}</span>
        <a :href="website" target="_blank">{{ website }}</a>
      </div>
    </div>
    <div class="description-info" v-if="description">
      {{ description }}
    </div>
    <div class="tail-info" v-if="createAtString || href">
      <span>{{ createAtString }}</span>
      <i class="seperator" v-if="createAtString && href"></i>
      <a :href="href" target="_blank">{{ href }}</a>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { formatDate } from '@commons/utils/date'

const props = defineProps({
  href: {
    type: String
  },
  avatar: {
    type: String
  },
  name: {
    type: String
  },
  createdAt: {
    type: String
  },
  description: {
    type: String,
    required: false
  },
  screenName: {
    type: String,
    required: false
  },
  location: {
    type: String,
    required: false
  },
  website: {
    type: String,
    required: false
  },
  followers: {
    type: Number,
    required: false
  },
  followings: {
    type: Number,
    required: false
  }
})

const createAtString = computed(() => {
  return props.createdAt ? formatDate(new Date(props.createdAt), 'YYYY-MM-DD HH:mm') : null
})

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}
</script>

<style lang="scss" scoped>
.tweet-user-info {
  --style: select-none pt-30px;

  .base-info {
    --style: flex;

    .avatar {
      --style: w-48px h-48px rounded-full object-cover;
    }

    .name {
      --style: ml-16px flex flex-col;

      .username {
        --style: text-(card txt) line-height-25px font-600;
      }

      .screen-name {
        --style: mt-2px text-(meta txt-light) line-height-20px;
      }
    }
  }

  .follow-info {
    --style: mt-23px flex items-center;

    .followers,
    .followings {
      --style: flex flex-col;

      span {
        --style: text-(card txt) line-height-25px font-600;
      }

      span + span {
        --style: mt-2px text-(meta txt-light) line-height-20px;
      }
    }

    .seperator {
      --style: w-1px h-36px bg-border mx-32px;
    }
  }

  .optional-info {
    --style: mt-24px;
    .optional-item {
      --style: 'relative pl-12px flex whitespace-pre not-first:(mt-8px)';

      &::before {
        --style: content-empty absolute bg-txt w-4px h-4px rounded-full top-8px left-0;
      }

      span,
      a {
        --style: text-meta line-height-20px;
      }

      span {
        --style: text-txt;
      }

      a {
        --style: text-#5490C2 underline-none decoration-none;
      }
    }
  }

  .description-info {
    --style: text-(meta txt) line-height-20px mt-14px whitespace-pre-line;
  }

  .tail-info {
    --style: mt-30px flex items-center;

    span {
      --style: text-(meta txt-light) line-height-20px;
    }

    .seperator {
      --style: w-1px h-10px bg-border mx-32px mx-10px;
    }

    a {
      --style: text-(meta #5490c2) line-height-20px underline-none decoration-none;
    }
  }
}
</style>
