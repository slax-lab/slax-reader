<template>
  <div class="social-post-user-info">
    <div class="base-info" v-if="showAvatar || name || screenName">
      <img class="avatar" v-if="showAvatar" :src="avatarUrl" alt="" @error="failedAvatar = avatarUrl" />
      <div class="name" v-if="name || screenName">
        <span class="username" v-if="name">
          {{ name }}
          <i class="verified" v-if="isVerified" aria-hidden="true"></i>
        </span>
        <span class="screen-name" v-if="screenName">{{ screenName }}</span>
      </div>
    </div>

    <div class="follow-info" v-if="hasFollowers || hasFollowings">
      <div class="followers" v-if="hasFollowers">
        <span>{{ followers }}</span>
        <span>{{ t('component.article_ce_social_post.followers') }}</span>
      </div>
      <i class="seperator" v-if="hasFollowers && hasFollowings"></i>
      <div class="followings" v-if="hasFollowings">
        <span>{{ followings }}</span>
        <span>{{ t('component.article_ce_social_post.followings') }}</span>
      </div>
    </div>

    <div class="optional-info" v-if="location || website">
      <div class="optional-item" v-if="location">
        <span>{{ t('component.article_ce_social_post.location') }}</span>
        <span>{{ location }}</span>
      </div>
      <div class="optional-item" v-if="website">
        <span>{{ t('component.article_ce_social_post.website') }}</span>
        <a :href="website" target="_blank">{{ website }}</a>
      </div>
    </div>

    <div class="description-info" v-if="description">
      {{ description }}
    </div>

    <div class="tail-info" v-if="createAtString || href">
      <span v-if="createAtString">{{ createAtString }}</span>
      <i class="seperator" v-if="createAtString && href"></i>
      <a v-if="href" :href="href" target="_blank">{{ href }}</a>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { formatDate } from '@commons/utils/date'

// 字段均为 dataset string，
// 缺省（空/undefined）则隐藏
const props = defineProps({
  platform: {
    type: String,
    required: false
  },
  href: {
    type: String,
    required: false
  },
  avatar: {
    type: String,
    required: false
  },
  name: {
    type: String,
    required: false
  },
  createdAt: {
    type: String,
    required: false
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
    type: String,
    required: false
  },
  followings: {
    type: String,
    required: false
  },
  verified: {
    type: String,
    required: false
  }
})

const isPresent = (v?: string) => v !== undefined && v !== null && v !== ''

// 头像：过滤假值 + 记录加载失败的地址，两者皆无才显示（换新址自动恢复）
const avatarUrl = computed(() => {
  const raw = props.avatar?.trim()
  if (!raw || raw === 'null' || raw === 'undefined') return ''
  return raw
})
const failedAvatar = ref('')
const showAvatar = computed(() => !!avatarUrl.value && avatarUrl.value !== failedAvatar.value)

const hasFollowers = computed(() => isPresent(props.followers))
const hasFollowings = computed(() => isPresent(props.followings))
// 仅认证用户传 "true"
const isVerified = computed(() => props.verified === 'true')

const createAtString = computed(() => {
  const raw = props.createdAt
  if (!isPresent(raw)) return null

  let date: Date
  if (/^\d+$/.test(raw!)) {
    // 纯数字按 epoch 解析（秒/毫秒）
    const n = Number(raw)
    date = new Date(n < 1e12 ? n * 1000 : n)
  } else {
    date = new Date(raw!)
  }

  return isNaN(date.getTime()) ? null : formatDate(date, 'YYYY-MM-DD HH:mm')
})

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}
</script>

<style lang="scss" scoped>
.social-post-user-info {
  --style: select-none;

  .base-info {
    --style: flex items-center;

    .avatar {
      --style: w-48px h-48px rounded-full object-cover flex-shrink-0;
    }

    .name {
      --style: flex flex-col min-w-0;
    }

    // 有头像才留左间距
    .avatar + .name {
      --style: ml-16px;
    }

    .username {
      --style: text-(card txt) line-height-25px font-600 flex items-center;
    }

    .verified {
      --style: ml-4px w-14px h-14px rounded-full bg-#5490c2 flex-shrink-0;
    }

    .screen-name {
      --style: mt-2px text-(meta txt-light) line-height-20px;
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
      --style: w-1px h-10px bg-border mx-10px;
    }

    a {
      --style: text-(meta #5490c2) line-height-20px underline-none decoration-none;
    }
  }
}
</style>
