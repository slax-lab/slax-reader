<template>
  <UserSubscribeSection v-if="userInfo" :user-info="userInfo" />
  <!-- 合集配置区已下线，移至 /collection/manage -->
  <UserApiKeySection v-if="userInfo" :user-info="userInfo" />
  <section class="settings-card">
    <div class="title">{{ $t('page.user.third_party_binding') }}</div>
    <div class="info">
      <div class="binding">
        <NavigateStyleButton v-if="!isEnablePlaform('telegram')" :title="$t('page.user.telegram')" @action="() => bindPlathform('telegram')" />
        <p v-else>Telegram: {{ getPlatformAccount('telegram') }}</p>
      </div>
      <div class="binding">
        <NavigateStyleButton v-if="!isEnablePlaform('twitter')" :title="$t('page.user.twitter')" @action="() => bindPlathform('twitter')" />
        <p v-else>Twitter: {{ getPlatformAccount('twitter') }}</p>
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import UserApiKeySection from '../UserApiKeySection.vue'
import UserSubscribeSection from '../UserSubscribeSection.vue'
import NavigateStyleButton from '~/components/NavigateStyleButton.vue'

import { RESTMethodPath } from '@commons/contracts/const'
import type { BindedPlatformInfo, UserDetailInfo } from '@commons/contracts/interface'

const emits = defineEmits(['update'])
const props = defineProps({
  userInfo: {
    type: Object as PropType<UserDetailInfo>,
    required: true
  }
})

const isEnablePlaform = (platform: string) => {
  return props.userInfo?.platform?.some((item: BindedPlatformInfo) => item.platform === platform)
}

const getPlatformAccount = (platform: string) => {
  return props.userInfo?.platform?.find((item: BindedPlatformInfo) => item.platform === platform)?.user_name || ''
}

const bindPlathform = async (type: string) => {
  const resp = await request()
    .post<string>({
      url: RESTMethodPath.GET_BIND_LINK,
      body: { platform: type }
    })
    .finally(() => {})
  if (!resp) {
    console.log('error')
    return
  } else {
    window.open(resp)

    setTimeout(() => {
      emits('update')
    }, 10000)
  }
}
</script>

<style lang="scss" scoped>
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
    .binding {
      --style: mt-24px;
    }
  }
}
</style>
