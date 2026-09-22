<template>
  <section class="settings-card">
    <div class="title">{{ $t('page.user.skills_cli_title') }}</div>
    <div class="info">
      <div class="setting-container">
        <div class="cli-install">
          <div class="install-tabs">
            <button :class="['tab-item', { active: activeInstallTab === 'manual' }]" @click="activeInstallTab = 'manual'">
              {{ $t('page.user.api_key_cli_manual') }}
            </button>
            <button :class="['tab-item', { active: activeInstallTab === 'ai-agent' }]" @click="activeInstallTab = 'ai-agent'">
              {{ $t('page.user.api_key_cli_ai_agent') }}
            </button>
          </div>

          <div class="install-content" v-if="activeInstallTab === 'manual'">
            <div class="install-hint">{{ $t('page.user.api_key_cli_manual_hint') }}</div>
            <div class="code-block">
              <code>npx @slax-lab/reader-cli@latest install</code>
              <button class="copy-btn" @click="copyInstallCommand">{{ $t('page.user.api_key_cli_copy') }}</button>
            </div>
          </div>

          <div class="install-content" v-else>
            <div class="install-hint">{{ $t('page.user.api_key_cli_ai_hint') }}</div>
            <div class="prompt-block">
              <p class="prompt-text">{{ $t('page.user.api_key_cli_ai_prompt', { url: aiAgentGuideUrl }) }}</p>
              <button class="copy-prompt-btn" @click="copyAiPrompt">{{ $t('page.user.api_key_cli_copy_prompt') }}</button>
            </div>
          </div>

          <div class="install-footer">
            <div class="completion-hint">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              {{ $t('page.user.api_key_cli_completion_hint') }}
            </div>
            <div class="open-source">
              <a href="https://github.com/slax-lab/slax-reader-cli" target="_blank" rel="noopener noreferrer">{{ $t('page.user.api_key_cli_open_source') }}</a>
            </div>
          </div>

          <div class="availability-hint">{{ $t('page.user.api_key_cli_availability_hint') }}</div>
        </div>

        <div class="section-divider"></div>

        <div class="api-key-block">
          <div class="subsection-title">{{ $t('page.user.api_key') }}</div>
          <div class="setting-header">
            <span>{{ $t('page.user.api_key_description') }}</span>
          </div>

          <template v-if="apiKey">
            <div class="setting-row">
              <div class="setting-content column">
                <div class="key-box">{{ displayKey }}</div>
                <div class="link-actions">
                  <button class="text-button" @click="viewAllAndCopyKey" v-if="apiKey.key">
                    {{ $t('page.user.api_key_view_all_and_copy') }}
                  </button>
                  <button class="text-button" @click="rollApiKey">
                    {{ $t('page.user.api_key_regenerate') }}
                  </button>
                </div>
              </div>
            </div>
          </template>

          <div class="operates" v-else>
            <template v-if="!isLoading">
              <button class="save" @click="generateApiKey">
                {{ $t('page.user.api_key_generate_and_copy') }}
              </button>
            </template>
            <div class="i-svg-spinners:180-ring-with-bg text-18px" style="color: var(--slax-accent)" v-else></div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { copyText } from '@commons/frontend-utils/string'

import { type UserApiKey, type UserApiKeyCreated, type UserDetailInfo } from '@commons/types/interface'
import { RESTMethodPath } from '@commons/types'
import Toast from '~/components/Toast'

const { t } = useI18n()

const props = defineProps({
  userInfo: {
    type: Object as PropType<UserDetailInfo>,
    required: true
  }
})

const apiKey = ref<UserApiKey | null>(null)
const isLoading = ref(false)
const isShowingFullKey = ref(false)
const activeInstallTab = ref<'manual' | 'ai-agent'>('manual')
const aiAgentGuideUrl = 'https://raw.githubusercontent.com/slax-lab/slax-reader-cli/refs/heads/main/docs/ai-agent-installation-guide.md'

const displayKey = computed(() => {
  if (!apiKey.value) {
    return ''
  }

  const fullKey = apiKey.value.key || ''
  if (isShowingFullKey.value && fullKey) {
    return fullKey
  }

  if (fullKey.length > 10) {
    return `${fullKey.slice(0, 6)}******${fullKey.slice(-4)}`
  }

  if (apiKey.value.short_key) {
    return `${apiKey.value.short_key}...`
  }

  return fullKey
})

const normalizeApiKey = (item: Partial<UserApiKey> & { id: number; name: string; created_at: string }, fallbackKey: string | null = null): UserApiKey => {
  const key = item.key || fallbackKey || null
  return {
    id: item.id,
    name: item.name,
    key,
    short_key: item.short_key || (key ? key.slice(0, 9) : null),
    expires_at: item.expires_at || null,
    created_at: item.created_at
  }
}

const copyInstallCommand = async () => {
  await copyText('npx @slax-lab/reader-cli@latest install')
  Toast.showToast({
    text: t('component.share_modal.copy_success')
  })
}

const copyAiPrompt = async () => {
  await copyText(t('page.user.api_key_cli_ai_prompt', { url: aiAgentGuideUrl }))
  Toast.showToast({
    text: t('component.share_modal.copy_success')
  })
}

const getApiKey = async () => {
  const result = await request().get<UserApiKey[] | UserApiKey>({
    url: RESTMethodPath.USER_API_KEYS
  })

  const currentKey = Array.isArray(result) ? result[0] : result
  const previousKey = apiKey.value?.key || null
  apiKey.value = currentKey ? normalizeApiKey(currentKey, previousKey) : null
  isShowingFullKey.value = false
}

const viewAllAndCopyKey = async () => {
  if (!apiKey.value) {
    return
  }

  if (!apiKey.value.key) {
    await getApiKey()
  }

  if (!apiKey.value?.key) {
    Toast.showToast({
      text: t('page.user.api_key_view_failed')
    })
    return
  }

  isShowingFullKey.value = true
  await copyText(apiKey.value.key)
  Toast.showToast({
    text: t('component.share_modal.copy_success')
  })
}

const generateApiKey = async () => {
  if (isLoading.value) {
    return
  }

  isLoading.value = true

  try {
    const result = await request().post<UserApiKeyCreated>({
      url: RESTMethodPath.USER_API_KEYS,
      body: {}
    })

    if (!result?.key) {
      return
    }

    apiKey.value = normalizeApiKey({
      ...result,
      key: result.key
    })
    isShowingFullKey.value = true
    await copyText(result.key)
    Toast.showToast({
      text: t('page.user.api_key_generated_and_copied')
    })
  } finally {
    isLoading.value = false
  }
}

const rollApiKey = async () => {
  if (isLoading.value) {
    return
  }

  isLoading.value = true

  try {
    const result = await request().post<UserApiKeyCreated>({
      url: RESTMethodPath.USER_API_KEY_ROLL,
      body: {}
    })

    if (!result?.key) {
      return
    }

    apiKey.value = normalizeApiKey({
      ...result,
      key: result.key
    })
    isShowingFullKey.value = true
    await copyText(result.key)
    Toast.showToast({
      text: t('page.user.api_key_regenerated_and_copied')
    })
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  getApiKey()
})
</script>

<style scoped lang="scss">
.settings-card {
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  padding: 24px;

  .title {
    font-family: var(--slax-font-serif);
    color: var(--slax-text);
    --style: font-600 text-h2 line-height-33px text-left select-none;
  }

  .info {
    --style: mt-24px;

    .setting-container {
      --style: 'overflow-hidden';

      .section-divider {
        --style: 'my-24px h-1px';
        background: var(--slax-border);
      }

      .subsection-title {
        --style: 'mb-12px font-600 select-none line-height-22px';
        font-family: var(--slax-font-serif);
        font-size: var(--slax-fs-body);
        color: var(--slax-text);
      }

      .setting-header {
        span {
          --style: text-14px line-height-20px;
          color: var(--slax-text-muted);
        }
      }

      .setting-row {
        --style: select-none;

        .setting-title {
          --style: relative pl-16px mt-24px;

          &:before {
            --style: absolute left-0 top-1/2 -translate-y-1/2 content-empty w-4px h-4px rounded-full;
            background: var(--slax-text);
          }

          span {
            --style: text-14px line-height-20px;
            color: var(--slax-text);
          }
        }

        .setting-content {
          --style: mt-10px flex items-center;

          &.column {
            --style: items-start flex-col;
          }

          span {
            --style: text-16px line-height-22px;
            color: var(--slax-text);
          }

          .key-box {
            --style: w-full break-all px-12px py-13px font-medium line-height-22px;
            font-family: var(--slax-font-mono, monospace);
            font-size: var(--slax-fs-aux);
            background: var(--slax-surface);
            border: 1px solid var(--slax-border);
            border-radius: var(--slax-radius-sm);
            color: var(--slax-text);
          }

          .link-actions {
            --style: mt-12px flex items-center gap-16px;

            .text-button {
              --style: text-14px line-height-20px font-medium;
              color: var(--slax-accent);

              &:hover {
                text-decoration: underline;
                opacity: 0.85;
              }
            }
          }
        }
      }

      .operates {
        --style: mt-20px flex justify-end;

        .save {
          --style: flex-center min-w-132px h-40px px-16px font-semibold line-height-40px transition-all duration-250;
          background: var(--slax-accent);
          color: var(--slax-btn-text);
          border-radius: var(--slax-radius-sm);
          font-size: var(--slax-fs-aux);

          &:hover {
            opacity: 0.92;
            transform: translateY(-1px);
          }

          &:active {
            transform: translateY(0);
            opacity: 1;
          }
        }
      }

      .tips {
        --style: mt-16px text-14px line-height-20px;
        color: var(--slax-text-muted);
      }

      .cli-install {
        .install-tabs {
          --style: flex gap-0 overflow-hidden w-fit;
          border: 1px solid var(--slax-border);
          border-radius: var(--slax-radius-sm);

          .tab-item {
            --style: px-16px py-8px text-14px line-height-20px bg-transparent transition-all duration-200;
            color: var(--slax-text-muted);

            &.active {
              background: var(--slax-accent);
              color: var(--slax-btn-text);
              --style: font-medium;
            }

            &:not(.active):hover {
              background: var(--slax-accent-bg);
            }
          }
        }

        .install-content {
          --style: mt-16px;

          .install-hint {
            --style: mb-10px text-13px line-height-18px;
            color: var(--slax-text-muted);
          }

          .code-block {
            --style: flex items-center justify-between px-16px py-12px;
            background: var(--slax-surface);
            border: 1px solid var(--slax-border);
            border-radius: var(--slax-radius-sm);

            code {
              --style: text-14px font-mono line-height-20px;
              color: var(--slax-text);
            }

            .copy-btn {
              --style: ml-12px px-10px py-4px rounded-4px text-12px bg-transparent transition-all duration-200;
              color: var(--slax-accent);

              &:hover {
                background: var(--slax-accent-bg);
              }
            }
          }

          .prompt-block {
            --style: mt-10px px-16px py-14px;
            background: var(--slax-surface);
            border: 1px solid var(--slax-border);
            border-radius: var(--slax-radius-sm);

            .prompt-text {
              --style: text-14px line-height-22px break-all;
              color: var(--slax-text-muted);
            }

            .copy-prompt-btn {
              --style: mt-12px px-14px py-6px rounded-6px text-13px font-medium transition-all duration-200;
              color: var(--slax-accent);
              background: var(--slax-surface-solid);
              border: 1px solid var(--slax-border);

              &:hover {
                background: var(--slax-accent-bg);
              }
            }
          }
        }

        .install-footer {
          --style: mt-16px flex items-center justify-start gap-16px;

          .completion-hint {
            --style: text-13px line-height-18px flex items-center gap-5px;
            color: var(--slax-text-muted);

            svg {
              flex-shrink: 0;
              color: var(--slax-accent);
            }
          }

          .open-source {
            --style: text-13px line-height-18px;
            color: var(--slax-text-muted);

            a {
              color: var(--slax-accent);

              &:hover {
                --style: underline;
              }
            }
          }
        }

        .availability-hint {
          --style: mt-16px text-13px line-height-18px;
          color: var(--slax-text-muted);
        }
      }
    }
  }
}
</style>
