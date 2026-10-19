<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  ref,
  watch,
  watchEffect,
} from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "vue-i18n";
import { ipc } from "./ipc/client";
import { useLibrary } from "./stores/library";
import type { AuthState, CoreError, SystemState } from "./ipc/generated";
import Icon from "./components/Icon.vue";
import Dialog from "./components/Dialog.vue";
import LibraryPane from "./components/LibraryPane.vue";
import ReaderPane from "./components/ReaderPane.vue";
import SettingsPane from "./components/SettingsPane.vue";
import RssPane from "./components/RssPane.vue";
import SourceSidebar from "./components/SourceSidebar.vue";
import SplitHandle from "./components/SplitHandle.vue";
import { useRss } from "./stores/rss";
const store = useLibrary(),
  { t, locale, te } = useI18n();
const rss = useRss();
const sidebar = computed(() => !store.preferences.sidebarCollapsed);
const width = ref(window.innerWidth);
const sidebarWidth = computed(() =>
  sidebar.value
    ? Math.min(store.preferences.sidebarWidth, Math.max(180, width.value - 584))
    : 80,
);
const listMax = computed(() =>
  Math.max(260, Math.min(560, width.value - sidebarWidth.value - 322)),
);
const listWidth = computed(() =>
  Math.min(store.preferences.listWidth, listMax.value),
);
function resized() {
  width.value = window.innerWidth;
}
function persistLayout() {
  void store.savePreferences({ ...store.preferences }).catch(store.fail);
}
const shell = ref<HTMLElement>(),
  aside = ref<HTMLElement>();
function toggleSidebar() {
  const before = sidebarWidth.value;
  store.preferences.sidebarCollapsed = !store.preferences.sidebarCollapsed;
  persistLayout();
  if (
    store.system.reduceMotion ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  void nextTick(() => {
    const delta = before - sidebarWidth.value;
    if (!delta || !shell.value) return;
    for (const node of shell.value.querySelectorAll<HTMLElement>(
      ":scope > .workspace-page, :scope > .settings-pane, :scope > .split-handle",
    ))
      node.animate(
        [{ transform: `translateX(${delta}px)` }, { transform: "none" }],
        { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
  });
}
const page = ref("library"),
  adding = ref(false),
  url = ref(""),
  addBusy = ref(false),
  addError = ref(""),
  loginBusy = ref(false),
  clipboard = ref<string | null>(null);
const pendingImport = ref<string | null>(null);
const unlisten: UnlistenFn[] = [];
watch(
  () => store.snapshot,
  (value) => {
    if (
      pendingImport.value &&
      value?.bookmarks.some((b) => b.id === pendingImport.value)
    ) {
      const id = pendingImport.value;
      pendingImport.value = null;
      void store.select(id);
    }
  },
);
let disposed = false;
watch(page, (next) => {
  store.cancelSearch();
  if (next === "library" && store.query.trim()) void store.search();
});
const syncLabel = computed(() =>
  !store.system.online
    ? t("offline")
    : store.sync?.authRequired
      ? t("errors.AUTH_REQUIRED")
      : store.sync?.error
        ? t("syncError")
        : store.sync?.pending
          ? t("pending", { count: store.sync.pending })
          : store.sync?.downloading || store.sync?.uploading
            ? t("syncing")
            : !store.sync?.hasSynced
              ? t("syncing")
              : t("synced"),
);
function errorText(code: string) {
  return t(te(`errors.${code}`) ? `errors.${code}` : "errors.default");
}
watchEffect(() => {
  locale.value = store.preferences.language;
  document.documentElement.lang = locale.value;
  document.documentElement.dataset.appearance =
    store.preferences.appearance === "system"
      ? store.system.dark
        ? "dark"
        : "light"
      : store.preferences.appearance;
  document.documentElement.dataset.opaque = String(
    store.system.reduceTransparency,
  );
  document.documentElement.dataset.motion = store.system.reduceMotion
    ? "reduce"
    : "normal";
});
async function login() {
  loginBusy.value = true;
  try {
    await ipc.login();
    store.auth.pending = true;
  } catch (e) {
    store.fail(e);
  } finally {
    loginBusy.value = false;
  }
}
async function add() {
  if (addBusy.value) return;
  addBusy.value = true;
  addError.value = "";
  try {
    await store.add(url.value);
    adding.value = false;
    url.value = "";
    clipboard.value = null;
  } catch (e) {
    addError.value = errorText((e as CoreError)?.code);
  } finally {
    addBusy.value = false;
  }
}
function chooseTag(id: string) {
  page.value = "library";
  void store.toggleTag(id);
}
function chooseRss(id: string | null) {
  page.value = "rss";
  void rss.chooseFeed(id);
}
function navigate(view: string) {
  page.value = "library";
  void store.navigate(view);
}
async function importPdf() {
  try {
    const id = await ipc.importPdf(store.auth.generation);
    if (id) {
      pendingImport.value = id;
      adding.value = false;
      navigate("inbox");
    }
  } catch (e) {
    store.fail(e);
  }
}
async function captureSuggestion() {
  if (!store.auth.user) return;
  const value = await ipc.capture(store.auth.generation);
  if (value) {
    url.value = value;
    adding.value = true;
  }
}
watch(
  () => store.auth.generation,
  () => {
    void captureSuggestion().catch(store.fail);
  },
);
async function clipboardSuggestion() {
  if (!store.auth.user) return;
  try {
    clipboard.value = await ipc.clipboard(store.auth.generation);
  } catch {}
}
async function register<T>(name: string, action: (value: T) => void) {
  const stop = await listen<T>(name, (event) => action(event.payload));
  if (disposed) stop();
  else unlisten.push(stop);
}
function droppedLink(event: DragEvent) {
  const transfer = event.dataTransfer;
  if (!transfer || !store.auth.user) return;
  const raw =
    transfer
      .getData("text/uri-list")
      .split(/\r?\n/)
      .find((value) => value.trim() && !value.startsWith("#")) ??
    transfer.getData("text/plain");
  try {
    const candidate = new URL(raw.trim());
    if (
      !["http:", "https:"].includes(candidate.protocol) ||
      candidate.username ||
      candidate.password ||
      raw.length > 8192
    )
      return;
    event.preventDefault();
    url.value = candidate.href;
    adding.value = true;
  } catch {}
}
function draggingLink(event: DragEvent) {
  if (
    event.dataTransfer?.types.some((type) =>
      ["text/uri-list", "text/plain"].includes(type),
    )
  )
    event.preventDefault();
}
onMounted(async () => {
  window.addEventListener("resize", resized);
  window.addEventListener("dragover", draggingLink);
  window.addEventListener("drop", droppedLink);
  await Promise.all([
    register<AuthState>("auth-state", (state) => void store.setAuth(state)),
    register<CoreError>("core-error", store.fail),
    register<SystemState>("system-state", (state) => {
      store.system = state;
    }),
    register<string>("menu-intent", (intent) => {
      if (["inbox", "starred", "archived"].includes(intent)) navigate(intent);
      else if (intent === "settings") page.value = "settings";
      else if (intent === "add") adding.value = true;
      else if (intent === "import_pdf") void importPdf();
      else if (intent === "sidebar") toggleSidebar();
    }),
    register<void>("window-restored", () => {
      void clipboardSuggestion();
    }),
    register<void>("capture-url", () => {
      void captureSuggestion().catch(store.fail);
    }),
    register<string>("pdf-imported", (id) => {
      pendingImport.value = id;
      navigate("inbox");
    }),
  ]);
  await store.initialize();
  await captureSuggestion().catch(store.fail);
  if (store.auth.user)
    void ipc.event(store.auth.generation, "desktop_open").catch(() => {});
  if (disposed) return;
  unlisten.push(
    await getCurrentWindow().onFocusChanged((event) => {
      if (event.payload) void clipboardSuggestion();
    }),
  );
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", resized);
  window.removeEventListener("dragover", draggingLink);
  window.removeEventListener("drop", droppedLink);
  disposed = true;
  unlisten.splice(0).forEach((stop) => stop());
  store.dispose();
});
</script>
<template>
  <div v-if="!store.auth.user" class="login-shell">
    <div class="login-titlebar" data-tauri-drag-region />
    <main class="login-content">
      <div class="brand-symbol"><Icon name="book" :size="40" /></div>
      <span class="brand-name">Slax Reader</span>
      <h1>{{ t("welcome") }}</h1>
      <p>{{ t("welcomeBody") }}</p>
      <button class="primary" :disabled="loginBusy" @click="login">
        {{ t(store.auth.pending ? "loginRetry" : "login")
        }}<Icon name="arrow" :size="16" /></button
      ><span class="muted login-note">{{
        t(store.auth.pending ? "loginPending" : "loginNote")
      }}</span
      ><button
        v-if="store.auth.pending"
        @click="
          ipc
            .cancelLogin()
            .then(() => (store.auth.pending = false))
            .catch(store.fail)
        "
      >
        {{ t("cancel") }}
      </button>
      <p v-if="store.error" class="error" role="alert">
        {{ errorText(store.error) }}
      </p>
    </main>
    <footer class="login-footer">
      <span>READ. THINK. KEEP.</span
      ><button
        @click="
          store.savePreferences({
            ...store.preferences,
            language: store.preferences.language === 'en' ? 'zh' : 'en',
          })
        "
      >
        {{ store.preferences.language === "en" ? "简体中文" : "English" }}
      </button>
    </footer>
  </div>
  <div
    v-else
    ref="shell"
    :key="store.auth.generation"
    class="workspace"
    :style="{
      '--sidebar-width': `${sidebarWidth}px`,
      '--list-width': `${listWidth}px`,
    }"
  >
    <aside ref="aside" class="sidebar" :class="{ collapsed: !sidebar }">
      <div class="traffic-space" data-tauri-drag-region />
      <div class="sidebar-brand" :class="{ centered: !sidebar }" data-tauri-drag-region>
        <span class="brand-mark"><Icon name="book" :size="17" /></span>
        <span v-if="sidebar" class="brand-wordmark" data-tauri-drag-region
          >Slax Reader</span
        >
      </div>
      <button
        class="save-button"
        :title="t('add')"
        :aria-label="t('add')"
        @click="adding = true"
      >
        <span class="save-glyph"><Icon name="plus" :size="16" /></span>
        <span v-if="sidebar" class="save-label">{{ t("add") }}</span>
        <kbd v-if="sidebar">⌘N</kbd>
      </button>
      <div v-if="sidebar" class="section-label">{{ t("library") }}</div>
      <nav>
        <button
          v-for="item in [
            { view: 'inbox', icon: 'inbox' },
            { view: 'starred', icon: 'star' },
            { view: 'archived', icon: 'archive' },
          ]"
          :key="item.view"
          :title="t(item.view)"
          :aria-label="t(item.view)"
          :class="{ active: page === 'library' && store.view === item.view }"
          @click="navigate(item.view)"
        >
          <Icon :name="item.icon" :size="18" /><span v-if="sidebar">{{
            t(item.view)
          }}</span>
        </button>
      </nav>
      <SourceSidebar
        :collapsed="!sidebar"
        :page="page"
        @rss="chooseRss"
        @collection="navigate(`collection:${$event}`)"
        @tag="chooseTag"
      />
      <div class="sidebar-foot">
        <div
          v-if="store.sync?.authRequired || store.auth.pending"
          class="reauthorize"
        >
          <button :disabled="loginBusy" @click="login">
            {{ t(store.auth.pending ? "loginRetry" : "reauthorize") }}</button
          ><button
            v-if="store.auth.pending"
            @click="
              ipc
                .cancelLogin()
                .then(() => (store.auth.pending = false))
                .catch(store.fail)
            "
          >
            {{ t("cancel") }}
          </button>
        </div>
        <div class="sync-status" :title="syncLabel">
          <Icon name="cloud" :size="14" /><span v-if="sidebar">{{
            syncLabel
          }}</span>
        </div>
        <button
          class="account-button"
          :title="t('settings')"
          :aria-label="t('settings')"
          @click="page = 'settings'"
        >
          <span class="avatar">{{
            store.auth.user.name.slice(0, 1).toUpperCase()
          }}</span
          ><span v-if="sidebar" class="account-copy"
            ><strong>{{ store.auth.user.name }}</strong
            ><small>{{ t("settings") }}</small></span
          ><span v-if="sidebar" class="spacer" /><Icon
            v-if="sidebar"
            name="settings"
            :size="15"
          />
        </button>
      </div>
    </aside>
    <SplitHandle
      v-if="sidebar"
      :target="aside"
      property="--sidebar-width"
      :model-value="sidebarWidth"
      :min="180"
      :max="Math.min(320, Math.max(180, width - 584))"
      :reset="232"
      :label="t('sidebarWidth')"
      @update:model-value="store.preferences.sidebarWidth = $event"
      @finish="persistLayout"
    />
    <div v-show="page === 'library'" class="workspace-page">
      <LibraryPane
        :list-width="listWidth"
        :list-max="listMax"
        @resize="store.preferences.listWidth = $event"
        @resize-end="persistLayout"
        @add="adding = true"
        @sidebar="toggleSidebar"
      /><ReaderPane />
    </div>
    <div v-show="page === 'rss'" class="workspace-page">
      <RssPane
        :active="page === 'rss'"
        :list-width="listWidth"
        :list-max="listMax"
        @resize="store.preferences.listWidth = $event"
        @resize-end="persistLayout"
        @sidebar="toggleSidebar"
      />
    </div>
    <SettingsPane v-if="page === 'settings'" @sidebar="toggleSidebar" />
    <Transition name="pop"
      ><div v-if="store.error" class="toast" role="alert">
        <span>{{ errorText(store.error) }}</span
        ><button
          v-if="store.error === 'AUTH_REQUIRED'"
          :disabled="loginBusy"
          @click="login"
        >
          {{ t("reauthorize") }}</button
        ><button
          class="icon-button"
          :aria-label="t('close')"
          @click="store.error = ''"
        >
          <Icon name="close" :size="14" />
        </button>
      </div></Transition
    ><Transition name="pop"
      ><div v-if="clipboard && !adding" class="clipboard">
        <Icon name="link" /><span>{{ t("clipboard") }}</span
        ><button
          @click="
            url = clipboard!;
            adding = true;
          "
        >
          {{ t("clipboardSave") }}</button
        ><button
          class="icon-button"
          :aria-label="t('close')"
          @click="clipboard = null"
        >
          <Icon name="close" :size="14" />
        </button>
      </div></Transition
    >
  </div>
  <Dialog
    v-if="adding && store.auth.user"
    :title="t('add')"
    @close="adding = false"
    ><p class="muted">{{ t("addBody") }}</p>
    <form @submit.prevent="add">
      <label class="sr-only" for="save-url">{{ t("url") }}</label
      ><input
        id="save-url"
        v-model="url"
        type="url"
        placeholder="https://"
        required
        maxlength="8192"
      />
      <p v-if="addError" class="error" role="alert">{{ addError }}</p>
      <div class="actions">
        <button type="button" @click="importPdf">{{ t("importPdf") }}</button
        ><span class="spacer" /><button type="button" @click="adding = false">
          {{ t("cancel") }}</button
        ><button class="primary" type="submit" :disabled="addBusy || !url">
          {{ t(addBusy ? "loading" : "save") }}
        </button>
      </div>
    </form></Dialog
  >
</template>
<style scoped>
.workspace {
  height: 100%;
  display: flex;
  background: var(--desktop-sidebar);
}
.sidebar {
  width: var(--sidebar-width);
  flex: 0 0 var(--sidebar-width);
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 0 12px 12px;
  overflow: hidden;
}
.traffic-space {
  height: 52px;
  flex-shrink: 0;
}
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px 18px;
  min-height: 38px;
  white-space: nowrap;
}
.brand-mark {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--desktop-accent-soft);
  border: 1px solid var(--desktop-accent-line);
  color: var(--desktop-accent);
  box-shadow: var(--desktop-shadow-soft);
}
.brand-wordmark {
  font: 600 19px/1 var(--desktop-serif);
  letter-spacing: -0.4px;
  color: var(--desktop-text);
}
.save-button {
  justify-content: flex-start;
  gap: 9px;
  width: 100%;
  background: var(--desktop-accent);
  color: var(--desktop-accent-text);
  border: 1px solid transparent;
  padding: 7px 9px;
  margin-bottom: 20px;
  font-weight: 600;
  font-size: 12.5px;
  box-shadow: 0 8px 20px rgba(120, 55, 32, 0.16);
}
.save-button:hover:not(:disabled) {
  background: var(--desktop-accent-hover);
}
.save-glyph {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
}
.save-button kbd {
  margin-left: auto;
  color: inherit;
  opacity: 0.7;
  border-color: rgba(255, 255, 255, 0.24);
}
.section-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--desktop-muted);
  padding: 0 10px 8px;
}
nav {
  display: grid;
  gap: 3px;
}
nav button {
  justify-content: flex-start;
  text-align: left;
  padding: 8px 10px;
  gap: 10px;
  font-size: 12.5px;
  border-radius: 8px;
}
nav button svg {
  color: var(--desktop-muted);
  flex-shrink: 0;
}
nav button.active {
  background: var(--desktop-selected);
  color: var(--desktop-accent);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--desktop-accent);
}
nav button.active svg {
  color: var(--desktop-accent);
}
nav button.active:focus-visible {
  box-shadow: inset 2px 0 0 var(--desktop-accent);
}
.sidebar-foot {
  flex-shrink: 0;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--desktop-border);
  display: grid;
  gap: 4px;
}
.reauthorize {
  display: grid;
  gap: 4px;
  padding: 4px 0;
  color: var(--desktop-accent);
  font-size: 11px;
}
.reauthorize button {
  justify-content: flex-start;
  padding: 5px 10px;
}
.sync-status {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 6px 10px;
  border-radius: 8px;
  color: var(--desktop-muted);
  font-size: 10.5px;
  line-height: 1.45;
}
.sync-status svg {
  margin-top: 1px;
  flex-shrink: 0;
}
.sync-status span {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.account-button {
  justify-content: flex-start;
  text-align: left;
  padding: 7px 8px;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 10px;
}
.account-button:focus-visible {
  box-shadow: 0 0 0 3px var(--desktop-accent-soft);
}
.account-button:hover:not(:disabled) {
  border-color: var(--desktop-border);
  background: var(--desktop-raised);
  box-shadow: var(--desktop-shadow-soft);
}
.avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: 1px solid var(--desktop-accent-line);
  background: var(--desktop-accent-soft);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--desktop-accent);
  font-weight: 600;
  font-size: 12px;
}
.account-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.account-copy strong {
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-copy small {
  color: var(--desktop-faint);
  font-size: 10px;
  margin: 0;
}
.account-button > svg {
  color: var(--desktop-faint);
  flex-shrink: 0;
}
.login-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: radial-gradient(
    1000px 720px at 50% -8%,
    var(--desktop-raised) 0%,
    var(--desktop-canvas) 58%,
    var(--desktop-sidebar) 100%
  );
}
.login-titlebar {
  height: 52px;
}
.login-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 18px;
  padding: 0 30px 60px;
  text-align: center;
}
.brand-symbol {
  width: 88px;
  height: 88px;
  display: grid;
  place-items: center;
  border-radius: 26px;
  background: var(--desktop-raised);
  border: 1px solid var(--desktop-accent-line);
  box-shadow:
    0 24px 60px rgba(120, 55, 32, 0.16),
    var(--desktop-shadow-card);
  color: var(--desktop-accent);
  margin-bottom: 6px;
}
.brand-name {
  font: 600 11px/1 var(--desktop-font);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--desktop-muted);
}
.login-content h1 {
  font: 500 clamp(30px, 4.4vw, 40px) / 1.2 var(--desktop-serif);
  letter-spacing: -1.1px;
  max-width: 560px;
  margin-top: 12px;
}
.login-content p {
  font-size: 14px;
  color: var(--desktop-muted);
  line-height: 1.75;
  max-width: 420px;
}
.login-content .primary {
  margin-top: 16px;
  gap: 14px;
  padding: 11px 20px;
}
.login-note {
  font-size: 11px;
  color: var(--desktop-faint);
}
.login-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 28px;
  color: var(--desktop-faint);
  font-size: 9px;
  letter-spacing: 0.18em;
}
.login-footer button {
  font-size: 11px;
  letter-spacing: 0;
  color: var(--desktop-muted);
}
.toast,
.clipboard {
  position: fixed;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--desktop-raised);
  border: 1px solid var(--desktop-border);
  border-radius: 12px;
  box-shadow: var(--desktop-shadow-float);
  padding: 7px 11px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 15;
  max-width: min(600px, calc(100vw - 40px));
  font-size: 12px;
}
.toast {
  color: var(--desktop-danger);
  bottom: 76px;
  border-color: var(--desktop-danger-soft);
}
.clipboard button {
  color: var(--desktop-accent);
}
.clipboard > svg {
  color: var(--desktop-accent);
  flex-shrink: 0;
}
.dialog form {
  display: grid;
  gap: 16px;
}
.dialog input {
  width: 100%;
}
</style>

<style scoped>
.sidebar.collapsed {
  padding: 0 10px 12px;
  border-right: 1px solid var(--desktop-border);
}
.collapsed .sidebar-brand {
  justify-content: center;
  padding: 0 0 16px;
}
.collapsed .save-button {
  width: 38px;
  height: 38px;
  margin: 0 auto 20px;
  padding: 0;
  justify-content: center;
  border-radius: 50%;
}
.collapsed .save-glyph {
  background: transparent;
}
.collapsed nav button,
.collapsed .account-button {
  justify-content: center;
  padding: 8px 0;
}
.collapsed nav button.active {
  box-shadow: inset 0 0 0 1px var(--desktop-accent-line);
}
.collapsed .sync-status {
  justify-content: center;
  padding: 8px 0;
}
.collapsed .sidebar-foot {
  gap: 6px;
}
.collapsed .account-button {
  padding: 7px 0;
}
</style>
