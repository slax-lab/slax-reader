<template>
  <section class="desktop-consent" aria-labelledby="desktop-consent-title">
    <h1 id="desktop-consent-title">{{ t("desktop_auth.title") }}</h1>
    <p>{{ t("desktop_auth.description") }}</p>
    <template v-if="signedIn">
      <p v-if="account" class="account">
        {{ account.name }}<br /><span>{{ account.email }}</span>
      </p>
      <p v-else role="status">{{ t("desktop_auth.loading") }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="issued">
        <p role="status">{{ t("desktop_auth.ready") }}</p>
        <a
          v-if="!expired"
          class="primary"
          :href="callback"
          @click="clearVisibleUrl"
          >{{ t("desktop_auth.open") }}</a
        >
        <p v-else>{{ t("desktop_auth.expired") }}</p>
        <button type="button" :disabled="busy" @click="restart">
          {{ t("desktop_auth.restart") }}
        </button>
      </template>
      <button
        v-else
        type="button"
        class="primary"
        :disabled="busy || !account || !environment"
        @click="authorize"
      >
        {{ busy ? t("desktop_auth.loading") : t("desktop_auth.authorize") }}
      </button>
      <button type="button" :disabled="busy" @click="switchAccount">
        {{ t("desktop_auth.switch") }}
      </button>
    </template>
    <LoginView v-else :redirect="desktopConsentPath(intent)" />
    <button type="button" :disabled="busy" @click="cancel">
      {{ t("desktop_auth.cancel") }}
    </button>
  </section>
</template>

<script setup lang="ts">
import LoginView from "~/components/global/LoginView.vue";

import { clearDesktopOAuth, desktopConsentPath } from "~/utils/desktopAuth";

import {
  DESKTOP_AUTH_PATHS,
  type DesktopAuthIntent,
  desktopCallback,
  type DesktopCodeResponse,
  desktopEnvironmentForWeb,
} from "@slax-reader/contracts/desktop-auth";
import type { UserInfo } from "@slax-reader/contracts/interface";
import { useUserStore } from "~/stores/user";

const props = defineProps<{ intent: DesktopAuthIntent }>();
const { t } = useI18n();
const environment = desktopEnvironmentForWeb(useRuntimeConfig().public.slaxEnv);
const users = useUserStore();
const auth = useAuth();
const signedIn = ref(haveRequestToken());
const account = ref<UserInfo | null>(null);
const busy = ref(false);
const error = ref("");
const callback = ref("");
const issued = ref(false);
const expired = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let disposed = false;
function clearVisibleUrl() {
  history.replaceState(null, "", "/login?client=mac");
}
function reset() {
  clearTimeout(timer);
  callback.value = "";
  issued.value = false;
  expired.value = false;
  error.value = "";
  generation++;
}
async function loadAccount() {
  const expected = generation;
  try {
    const value = await users.refreshServerUserInfo();
    if (!disposed && expected === generation) account.value = value;
  } catch {
    if (!disposed && expected === generation) {
      error.value = t("desktop_auth.failed");
      account.value = null;
    }
  }
}
async function authorize() {
  if (busy.value || !account.value || !environment || disposed) return;
  busy.value = true;
  error.value = "";
  const expected = generation;
  try {
    const current = await users.refreshServerUserInfo();
    if (disposed || expected !== generation) return;
    if (current.userId !== account.value.userId) {
      account.value = current;
      error.value = t("desktop_auth.changed");
      return;
    }
    const result = await request().post<DesktopCodeResponse>({
      url: DESKTOP_AUTH_PATHS.code,
      body: {
        code_challenge: props.intent.code_challenge,
        state: props.intent.state,
      },
    });
    if (disposed || expected !== generation) return;
    if (!result) throw new Error("Invalid desktop authorization");
    const deadline = Date.parse(result.expires_at);
    if (
      !Number.isFinite(deadline) ||
      deadline <= Date.now() ||
      deadline > Date.now() + 125000
    )
      throw new Error("Invalid desktop authorization");
    callback.value = desktopCallback(result.code, props.intent.state, environment);
    issued.value = true;
    timer = setTimeout(
      () => {
        expired.value = true;
        callback.value = "";
        clearVisibleUrl();
      },
      Math.max(0, deadline - Date.now()),
    );
    clearVisibleUrl();
    location.assign(callback.value);
  } catch {
    if (!disposed && expected === generation)
      error.value = t("desktop_auth.failed");
  } finally {
    if (!disposed && expected === generation) busy.value = false;
  }
}
async function switchAccount() {
  reset();
  account.value = null;
  await auth.clearAuth();
  signedIn.value = false;
}
async function restart() {
  reset();
  await loadAccount();
}
async function cancel() {
  reset();
  clearDesktopOAuth();
  await navigateTo("/bookmarks", { replace: true });
}
onMounted(() => {
  if (signedIn.value) void loadAccount();
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  clearTimeout(timer);
});
</script>

<style scoped>
.desktop-consent {
  width: 100%;
  padding: 32px;
  color: var(--slax-text);
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  display: grid;
  gap: 16px;
}
h1 {
  font-family: var(--slax-font-sans);
  font-size: var(--slax-fs-h2);
  line-height: 1.3;
  margin: 0;
}
p {
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.account span {
  color: var(--slax-text-muted);
}
button,
a {
  font: inherit;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  padding: 12px 16px;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}
.primary {
  background: var(--slax-accent);
  color: var(--slax-btn-text);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
@media (max-width: 540px) {
  .desktop-consent {
    padding: 20px;
  }
}
</style>
