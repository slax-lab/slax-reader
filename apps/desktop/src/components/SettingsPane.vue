<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { Subscription } from "../ipc/generated";
import { useI18n } from "vue-i18n";
import { useLibrary } from "../stores/library";
import { ipc } from "../ipc/client";
import Icon from "./Icon.vue";
import Dialog from "./Dialog.vue";
const labs = ref<{ key: string; enabled: boolean }[]>([]),
  updateVersion = ref(""),
  updateChecked = ref(false);
const subscription = ref<Subscription | null>(null);
const store = useLibrary(),
  { t, te } = useI18n();
defineEmits<{ sidebar: [] }>();
const feedback = ref(false),
  content = ref(""),
  followUp = ref(false),
  busy = ref(false),
  sent = ref(false),
  error = ref(""),
  signingOut = ref(false),
  hasPending = ref(false),
  deleting = ref(false),
  confirmation = ref(""),
  deleteBlocked = ref(false),
  profileName = ref(store.auth.user?.name ?? "");
const errorText = (e: unknown) => {
  const code = (e as { code?: string })?.code;
  return t(code && te(`errors.${code}`) ? `errors.${code}` : "errors.default");
};
onMounted(() => {
  void ipc
    .product<{ features: { key: string; enabled: boolean }[] }>(
      store.auth.generation,
      "labs",
    )
    .then((value) => (labs.value = value.features))
    .catch(store.fail);
  void ipc
    .subscription(store.auth.generation)
    .then((value) => (subscription.value = value))
    .catch(store.fail);
});
async function lab(key: string, enabled: boolean) {
  try {
    await ipc.product(store.auth.generation, "labs_set", { key, enabled });
  } catch (e) {
    store.fail(e);
  }
}
async function updates() {
  try {
    const result = await ipc.updateCheck();
    updateChecked.value = true;
    updateVersion.value = result.version ?? "";
    if (!result.configured) store.error = "UPDATE_NOT_CONFIGURED";
  } catch (e) {
    store.fail(e);
  }
}
async function save() {
  try {
    await store.savePreferences({ ...store.preferences });
  } catch (e) {
    store.fail(e);
  }
}
async function feedbackSend() {
  busy.value = true;
  error.value = "";
  try {
    await ipc.product(store.auth.generation, "feedback", {
      content: content.value,
      allowFollowUp: followUp.value,
    });
    sent.value = true;
    content.value = "";
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
async function prepareSignOut() {
  try {
    hasPending.value = (await ipc.pending(store.auth.generation)) > 0;
    signingOut.value = true;
  } catch (e) {
    store.fail(e);
  }
}
async function signOut() {
  busy.value = true;
  try {
    await store.signOut(hasPending.value);
    signingOut.value = false;
  } catch (e) {
    store.fail(e);
  } finally {
    busy.value = false;
  }
}
async function deleteAccount() {
  busy.value = true;
  error.value = "";
  try {
    const result = await ipc.product<{ canDelete: boolean }>(
      store.auth.generation,
      "account_delete",
      { confirmation: confirmation.value },
    );
    if (result.canDelete) {
      await store.signOut(true);
      deleting.value = false;
    } else deleteBlocked.value = true;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="settings-pane">
    <header class="toolbar" data-tauri-drag-region>
      <button
        class="icon-button"
        :aria-label="t('toggleSidebar')"
        :title="t('toggleSidebar')"
        @click="$emit('sidebar')"
      >
        <Icon name="sidebar" />
      </button>
      <h2>{{ t("settings") }}</h2>
    </header>
    <div class="settings-scroll">
      <div class="settings-content">
        <section class="settings-card">
          <h2>{{ t("account") }}</h2>
          <div class="profile">
            <span class="profile-avatar">{{
              store.auth.user?.name.slice(0, 1).toUpperCase()
            }}</span>
            <div>
              <strong>{{ store.auth.user?.name }}</strong>
              <p>{{ store.auth.user?.email }}</p>
            </div>
          </div>
          <button
            class="setting-link"
            @click="
              ipc
                .browser(store.auth.generation, 'subscription')
                .catch(store.fail)
            "
          >
            {{ t("subscription")
            }}<span v-if="subscription?.subscribed" class="muted"
              >✓ {{ subscription.source }}</span
            ><Icon name="chevron" :size="15" />
          </button>
        </section>
        <section class="settings-card">
          <h2>{{ t("appearance") }}</h2>
          <div class="setting-row">
            <label for="language">{{ t("language") }}</label
            ><select
              id="language"
              v-model="store.preferences.language"
              @change="save"
            >
              <option value="en">English</option>
              <option value="zh">简体中文</option>
            </select>
          </div>
          <div class="setting-row">
            <label for="appearance">{{ t("appearance") }}</label
            ><select
              id="appearance"
              v-model="store.preferences.appearance"
              @change="save"
            >
              <option
                v-for="value in ['system', 'light', 'dark']"
                :key="value"
                :value="value"
              >
                {{ t(value) }}
              </option>
            </select>
          </div>
        </section>
        <section class="settings-card">
          <h2>{{ t("download") }}</h2>
          <div class="setting-row">
            <label for="cache-limit">{{ t("offlineCache") }}</label
            ><select
              id="cache-limit"
              v-model.number="store.preferences.latestN"
              @change="save"
            >
              <option
                v-for="count in [30, 50, 100, 200, 0]"
                :key="count"
                :value="count"
              >
                {{ count === 0 ? t("unlimited") : t("items", { count }) }}
              </option>
            </select>
          </div>
          <button
            class="setting-link"
            @click="ipc.clearCache(store.auth.generation).catch(store.fail)"
          >
            {{ t("clearCache") }}<Icon name="trash" :size="15" />
          </button>
        </section>
        <section class="settings-card">
          <h2>{{ t("labs") }}</h2>
          <p v-if="!labs.length" class="settings-empty">{{ t("noLabs") }}</p>
          <label v-for="feature in labs" :key="feature.key" class="setting-row"
            ><span>{{
              feature.key === "youtube" ? "YouTube" : feature.key.toUpperCase()
            }}</span
            ><input
              v-model="feature.enabled"
              type="checkbox"
              @change="lab(feature.key, feature.enabled)"
          /></label>
        </section>
        <section class="settings-card">
          <button class="setting-link" @click="updates">
            {{ t("checkUpdates")
            }}<span v-if="updateChecked && !updateVersion" class="muted">{{
              t("synced")
            }}</span></button
          ><button
            v-if="updateVersion"
            class="setting-link"
            @click="ipc.updateInstall().catch(store.fail)"
          >
            {{ t("installUpdate") }} {{ updateVersion }}</button
          ><button
            class="setting-link"
            @click="
              feedback = true;
              sent = false;
            "
          >
            {{ t("feedback") }}<Icon name="chevron" :size="15" /></button
          ><button class="setting-link" @click="prepareSignOut">
            {{ t("signOut") }}<Icon name="chevron" :size="15" /></button
          ><button
            class="setting-link danger"
            @click="
              deleting = true;
              deleteBlocked = false;
              error = '';
              confirmation = '';
            "
          >
            {{ t("deleteAccount") }}<Icon name="trash" :size="15" />
          </button>
        </section>
        <footer>Slax Reader · 0.1.0</footer>
      </div>
    </div>
  </section>
  <Dialog v-if="feedback" :title="t('feedback')" @close="feedback = false"
    ><p v-if="sent" role="status">{{ t("feedbackSent") }}</p>
    <template v-else
      ><p class="muted">{{ t("feedbackBody") }}</p>
      <textarea
        v-model="content"
        :aria-label="t('feedback')"
        maxlength="10000"
      /><label class="check-row"
        ><input v-model="followUp" type="checkbox" />{{
          t("allowFollowUp")
        }}</label
      >
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button
          class="primary"
          :disabled="busy || !content.trim()"
          @click="feedbackSend"
        >
          {{ t(busy ? "loading" : "save") }}
        </button>
      </div></template
    ></Dialog
  >
  <Dialog v-if="signingOut" :title="t('signOut')" @close="signingOut = false"
    ><p>{{ t(hasPending ? "pendingConfirm" : "signOutConfirm") }}</p>
    <div class="actions">
      <button @click="signingOut = false">{{ t("cancel") }}</button
      ><button class="danger" :disabled="busy" @click="signOut">
        {{ t(hasPending ? "discard" : "signOut") }}
      </button>
    </div></Dialog
  >
  <Dialog v-if="deleting" :title="t('deleteAccount')" @close="deleting = false"
    ><p>
      {{ t(deleteBlocked ? "deleteAccountBlocked" : "deleteAccountBody") }}
    </p>
    <input
      v-if="!deleteBlocked"
      v-model="confirmation"
      type="email"
      :placeholder="store.auth.user?.email"
      :aria-label="t('account')"
      autocomplete="off"
    />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="actions">
      <button @click="deleting = false">{{ t("cancel") }}</button
      ><button
        v-if="deleteBlocked"
        @click="ipc.browser(store.auth.generation, 'profile').catch(store.fail)"
      >
        {{ t("account") }}</button
      ><button
        v-else
        class="danger"
        :disabled="busy || confirmation !== store.auth.user?.email"
        @click="deleteAccount"
      >
        {{ t("deleteAccount") }}
      </button>
    </div></Dialog
  >
</template>
<style scoped>
.settings-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--desktop-surface);
}
.settings-scroll {
  overflow: auto;
  flex: 1;
}
.settings-content {
  max-width: 760px;
  padding: 32px 40px 80px;
  margin: 0 auto;
}
.settings-card {
  border: 1px solid var(--desktop-border);
  border-radius: 14px;
  background: var(--desktop-raised);
  padding: 6px 22px 10px;
  margin-bottom: 18px;
  box-shadow: var(--desktop-shadow-soft);
}
.settings-card h2 {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--desktop-muted);
  padding: 14px 0 6px;
}
.settings-empty {
  color: var(--desktop-muted);
  font-size: 12px;
  padding: 6px 0 14px;
}
.profile {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 8px 0 18px;
}
.profile-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--desktop-accent-soft);
  border: 1px solid var(--desktop-accent-line);
  color: var(--desktop-accent);
  font-size: 19px;
  font-weight: 600;
}
.profile strong {
  font-size: 14px;
  font-weight: 600;
}
.profile p {
  color: var(--desktop-muted);
  font-size: 12px;
  margin-top: 4px;
  user-select: text;
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 54px;
  border-bottom: 1px solid var(--desktop-border);
  font-size: 12.5px;
}
.setting-row:last-child {
  border: 0;
}
.setting-row select {
  max-width: 200px;
  min-height: 30px;
  padding: 5px 8px;
  font-size: 12px;
}
.setting-row input {
  max-width: 220px;
}
.setting-link {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: calc(100% + 16px);
  margin: 0 -8px;
  padding: 13px 8px;
  border-radius: 0;
  min-height: 50px;
  border-bottom: 1px solid var(--desktop-border);
  font-size: 12.5px;
}
.setting-link:last-child {
  border: 0;
}
.setting-link:hover:not(:disabled) {
  background: var(--desktop-hover);
  border-radius: 8px;
  color: var(--desktop-accent);
}
.setting-link > svg {
  color: var(--desktop-faint);
}
.setting-link:hover > svg {
  color: var(--desktop-accent);
}
footer {
  font-size: 10.5px;
  color: var(--desktop-faint);
  text-align: center;
  margin-top: 28px;
  letter-spacing: 0.04em;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
</style>
