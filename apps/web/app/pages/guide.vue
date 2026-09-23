<template>
  <div class="guide">
    <div class="header">
      <div class="header-container responsive-width">
        <div class="left">
          <div class="app" @click="logoClick">
            <div class="items-wrapper">
              <span class="title">{{ $t('common.app.name') }}</span>
            </div>
          </div>
        </div>
        <div class="right"></div>
      </div>
    </div>
    <div class="content">
      <div class="responsive-width guide-container">
        <div class="guide-header">
          <img src="@images/smileface-bg.png" />
          <div class="text">
            <h1>{{ $t('page.guide.title') }}</h1>
            <span>{{ $t('page.guide.subtitle') }}</span>
          </div>
        </div>
        <div class="guide-content">
          <div class="scroll-content">
            <div v-for="(guide, index) in guides" :key="guide.title" class="guide-card">
              <h1>{{ (index + 1).toString().padStart(2, '0') }}</h1>
              <span>{{ guide.title }}</span>
              <img :src="guide.img" />
            </div>
          </div>
        </div>
        <div class="guide-footer" v-if="!isLogined">
          <span class="footer-title">{{ $t('page.guide.operate_title') }}</span>
          <div class="operate">
            <GoogleLoginButton />
          </div>
        </div>
        <div class="guide-footer" v-else>
          <button class="use" @click="logoClick">{{ $t('page.guide.use') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import GoogleLoginButton from '~/components/GoogleLoginButton.vue'

import { useUserStore } from '~/stores/user'

interface Guide {
  title: string
  img: string
}

const { t } = useI18n()
const isLogined = haveRequestToken()

const guides: Guide[] = [
  {
    title: t('page.guide.guides.1.title'),
    img: new URL('@images/guide-banner-cover-1.png', import.meta.url).href
  },
  {
    title: t('page.guide.guides.2.title'),
    img: new URL('@images/guide-banner-cover-2.png', import.meta.url).href
  },
  {
    title: t('page.guide.guides.3.title'),
    img: new URL('@images/guide-banner-cover-3.png', import.meta.url).href
  }
]

const userStore = useUserStore()

const logoClick = () => {
  navigateTo(userStore.userInfo ? '/bookmarks' : '/guide', {
    replace: true
  })
}
</script>

<style lang="scss" scoped>
.guide {
  --style: w-full flex flex-col items-center overflow-hidden select-none;

  // 内容左侧留白：桌面 128px，移动端收紧到 16px（与顶栏共用，保证 logo 与正文对齐）
  .responsive-width {
    --style: pl-128px;

    @media (max-width: 768px) {
      --style: pl-16px pr-16px;
    }
  }

  // 顶栏：固定全宽，毛玻璃浮层 + 极淡底边
  .header {
    --style: 'fixed top-0 left-0 w-full h-[var(--slax-header-height)] z-100 p-0 flex items-center select-none';
    background: var(--slax-topbar-bg);
    backdrop-filter: var(--slax-blur);
    border-bottom: 1px solid var(--slax-border);

    .header-container {
      --style: w-full flex items-center justify-between;
    }

    .left {
      .app {
        --style: flex items-center relative cursor-pointer;

        .items-wrapper {
          --style: flex items-center;

          & > * {
            --style: 'not-first:ml-8px shrink-0';
          }

          img {
            --style: w-20px;
          }

          // Logo 文字走衬线品牌档，深色而非强调色（DESIGN §四）
          .title {
            font-family: var(--slax-font-serif);
            font-size: var(--slax-fs-brand);
            font-weight: 500;
            color: var(--slax-text);
            letter-spacing: -0.02em;
          }
        }
      }
    }
  }

  .content {
    --style: w-full pt-[var(--slax-header-height)] pb-68px;
    .guide-container {
      --style: pt-40px;

      .guide-header {
        --style: flex items-center;
        img {
          --style: w-132px;
        }

        .text {
          --style: ml-24px flex flex-col whitespace-nowrap;

          // 欢迎大标题：衬线 display 档 + 负字距
          h1 {
            font-family: var(--slax-font-serif);
            font-size: var(--slax-fs-display);
            font-weight: 500;
            color: var(--slax-text);
            letter-spacing: -0.02em;
            line-height: 1.4;
          }

          span {
            --style: mt-12px;
            font-size: var(--slax-fs-body);
            color: var(--slax-text-muted);
            line-height: 1.6;
          }
        }
      }

      .guide-content {
        --style: w-full relative;

        // 左右渐隐遮罩，提示横向可滚动；颜色取页面底色 token
        &::before,
        &::after {
          content: '';
          --style: z-2 absolute w-10px h-full top-0;
          pointer-events: none;
        }

        &::before {
          --style: -left-10px;
          background: linear-gradient(to right, var(--slax-bg), transparent);
        }

        &::after {
          --style: right-0px;
          background: linear-gradient(to left, var(--slax-bg), transparent);
        }

        .scroll-content {
          --style: overflow-auto mt-40px flex px-10px -ml-10px;
          scroll-snap-type: x mandatory;
          scrollbar-width: none;
          &::-webkit-scrollbar {
            --style: hidden;
          }

          // 引导卡片：暖色半透明表面 + 极淡边框 + 顶部内高光，hover 浮起
          .guide-card {
            --style: p-24px max-w-402px min-h-320px flex flex-col flex-start;
            background: var(--slax-surface);
            border: 1px solid var(--slax-border);
            border-radius: var(--slax-radius);
            box-shadow: inset 0 1px 0 var(--slax-inset-hi);
            transition: all var(--slax-dur-normal);
            scroll-snap-align: center;

            &:hover {
              box-shadow:
                var(--slax-shadow-warm),
                inset 0 1px 0 var(--slax-inset-hi);
              transform: translateY(-1px);
            }

            &:not(:first-child) {
              --style: ml-16px;
            }

            // 序号：衬线大字、弱化色，作为克制的装饰性索引
            h1 {
              font-family: var(--slax-font-serif);
              font-size: var(--slax-fs-display);
              font-weight: 500;
              color: var(--slax-text-light);
              letter-spacing: -0.02em;
              line-height: 1.2;
            }

            span {
              --style: mt-16px;
              font-size: var(--slax-fs-body);
              font-weight: 500;
              color: var(--slax-text);
              line-height: 1.6;
            }

            img {
              --style: mt-30px w-355px object-contain;
            }
          }
        }
      }
    }
  }

  .guide-footer {
    --style: mt-68px flex items-center;

    .footer-title {
      --style: shrink-0;
      font-size: var(--slax-fs-body);
      font-weight: 500;
      color: var(--slax-text);
      line-height: 1.6;
    }

    .operate {
      --style: ml-24px;
      // eslint-disable-next-line vue-scoped-css/no-unused-selector
      .google-login-button {
        --style: w-274px;
      }
    }

    // 主按钮（DESIGN §七）：accent 底、btn-text 文字、hover 浮起 + 柔光
    .use {
      --style: 'inline-flex items-center justify-center h-44px px-28px';
      background: var(--slax-accent);
      color: var(--slax-btn-text);
      border: none;
      border-radius: var(--slax-radius-sm);
      font-size: var(--slax-fs-aux);
      font-weight: 500;
      cursor: pointer;
      transition: all var(--slax-dur-normal);

      &:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 8px color-mix(in srgb, var(--slax-accent) 20%, transparent);
      }

      &:active {
        transform: translateY(0);
      }
    }
  }
}
</style>
