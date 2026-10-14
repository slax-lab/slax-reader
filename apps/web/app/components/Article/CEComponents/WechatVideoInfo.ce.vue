<template>
  <div class="wechat-video-info">
    <div class="card-container">
      <div class="info-container">
        <div class="left">
          <div class="thumbnail">
            <img :src="data.url" alt="Video thumbnail" />
          </div>
        </div>

        <div class="right">
          <div class="user">
            <div class="avatar">
              <img :src="data.headimgurl" alt="User avatar" />
            </div>
            <div class="name">
              <span>{{ data.nickname }}</span>
            </div>
          </div>

          <div class="descript">
            <p>{{ data.desc }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { PropType } from 'vue'

export type VideoInfo = {
  url: string
  headimgurl: string
  nickname: string
  desc: string
}

defineProps({
  data: {
    type: Object as PropType<VideoInfo>,
    required: true
  }
})
</script>

<style lang="scss" scoped>
.wechat-video-info {
  --style: my-6 max-w-3xl mx-auto;
  .card-container {
    --style: overflow-hidden border border-gray-100 rounded-xl bg-white shadow-sm select-none;

    .info-container {
      --style: flex;

      .left {
        --style: relative w-2/5;

        .thumbnail {
          --style: relative pt-[140%];

          img {
            --style: absolute inset-0 h-full w-full object-cover;
          }
        }
      }

      .right {
        --style: w-3/5 flex flex-col justify-between p-6;

        .user {
          --style: mb-4 flex items-center space-x-4;

          .avatar {
            --style: h-12 w-12 flex-shrink-0 overflow-hidden border border-gray-100 rounded-full;

            img {
              --style: w-full h-full object-cover;
            }
          }

          .name {
            --style: min-w-0 flex-1;

            span {
              --style: truncate text-base text-gray-900 font-semibold;
            }
          }
        }

        .descript {
          --style: min-h-0 flex-1;

          p {
            --style: line-clamp-5 text-sm text-gray-600;
          }
        }
      }
    }
  }
}
</style>
