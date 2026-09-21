<template>
  <div class="slug">
    <div class="slug-topbar">
      <div class="topbar-inner">
        <span class="topbar-logo" @click="logoClick">{{ $t('common.app.name') }}</span>
      </div>
    </div>
    <div class="content">
      <div class="slug-container">
        <div class="empty-illustration">
          <svg width="72" height="72" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" stroke="var(--slax-accent)" stroke-width="1.5" stroke-linecap="round" />
            <circle cx="12" cy="17" r="0.6" fill="var(--slax-accent)" />
          </svg>
        </div>
        <span class="slug-message">{{ errorMessage }}</span>
        <button class="back-btn" @click="logoClick">{{ $t('page.slug.back_home') }}</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
const { t } = useI18n()

const props = defineProps({
  error: Object
})

const logoClick = () => {
  navigateTo('/bookmarks', {
    replace: true
  })
}

const errorMessage = computed(() => {
  const error = props.error
  if (error?.statusCode === 404) {
    return t('page.slug.title')
  }

  let errorMessage = `${error?.statusCode}`
  if (isNuxtError(error)) {
    errorMessage += `: ${error.cause}`
  } else {
    if (error?.data) {
      errorMessage += `: ${error.data}`
    } else if (error?.message) {
      errorMessage += `: ${error.message}`
    }
  }

  return errorMessage
})
</script>

<style lang="scss" scoped>
.slug {
  --style: w-full flex flex-col items-center overflow-hidden select-none;

  .slug-topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--slax-header-height);
    background: var(--slax-topbar-bg);
    backdrop-filter: var(--slax-blur);
    border-bottom: 1px solid var(--slax-border);
    z-index: 100;
  }

  .topbar-inner {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 24px;
    height: 100%;
    display: flex;
    align-items: center;
  }

  .topbar-logo {
    font-family: var(--slax-font-serif);
    font-size: var(--slax-fs-brand);
    font-weight: 500;
    color: var(--slax-text);
    letter-spacing: -0.02em;
    cursor: pointer;
  }

  .content {
    --style: w-full h-screen flex-center -translate-y-25px;
    padding-top: var(--slax-header-height);

    .slug-container {
      --style: flex-center flex-col z-2;

      .empty-illustration {
        color: var(--slax-text-muted);
      }

      .slug-message {
        margin-top: 16px;
        font-size: var(--slax-fs-meta);
        color: var(--slax-text-muted);
        line-height: 20px;
        text-align: center;
        white-space: pre-line;
      }

      .back-btn {
        margin-top: 40px;
        padding: 10px 32px;
        font-size: var(--slax-fs-body);
        font-weight: 500;
        color: var(--slax-text-muted);
        background: transparent;
        border: 1px solid var(--slax-border);
        border-radius: var(--slax-radius-sm);
        cursor: pointer;
        transition: all var(--slax-dur-normal);

        &:hover {
          background: var(--slax-surface);
          color: var(--slax-text);
          border-color: color-mix(in srgb, var(--slax-text-light) 40%, var(--slax-border));
        }
      }
    }
  }
}
</style>
