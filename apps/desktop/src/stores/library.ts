import { defineStore } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";
import { ipc } from "../ipc/client";
import type {
  AuthState,
  BuildInfo,
  Bookmark,
  BookmarkAction,
  LibrarySnapshot,
  ReaderDocument,
  SyncState,
  Preferences,
  SystemState,
  CoreError,
} from "../ipc/generated";
export const useLibrary = defineStore("library", () => {
  const auth = ref<AuthState>({ user: null, pending: false, generation: "" });
  const build = ref<BuildInfo | null>(null);
  const snapshot = shallowRef<LibrarySnapshot | null>(null),
    sync = shallowRef<SyncState | null>(null),
    document = shallowRef<ReaderDocument | null>(null);
  const view = ref("inbox"),
    query = ref(""),
    selectedTags = ref<string[]>([]),
    selected = ref<string | null>(null),
    loading = ref(true),
    readerLoading = ref(false),
    error = ref(""),
    readerError = ref("");
  const preferences = ref<Preferences>({
    language: navigator.language.startsWith("zh") ? "zh" : "en",
    appearance: "system",
    latestN: 50,
    sidebarWidth: 232,
    listWidth: 336,
    sidebarCollapsed: false,
  });
  const system = ref<SystemState>({
    online: true,
    expensive: false,
    constrained: false,
    sleeping: false,
    reduceTransparency: false,
    reduceMotion: false,
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
  });
  let watchId: string | undefined,
    epoch = 0,
    readerEpoch = 0;
  const searchRows = shallowRef<Bookmark[]>([]);
  const searchMode = ref<"local" | "cloud">("local");
  const searching = ref(false),
    searchError = ref("");
  let searchEpoch = 0,
    searchRequest: string | undefined,
    searchTimer: ReturnType<typeof setTimeout> | undefined;
  const rows = computed(() =>
    query.value.trim() ? searchRows.value : (snapshot.value?.bookmarks ?? []),
  );
  const current = computed(
    () =>
      snapshot.value?.bookmarks.find((b) => b.id === selected.value) ??
      searchRows.value.find((b) => b.id === selected.value) ??
      null,
  );
  function cancelSearch() {
    searchEpoch++;
    clearTimeout(searchTimer);
    if (searchRequest) void ipc.unwatch(searchRequest).catch(() => {});
    searchRequest = undefined;
    searching.value = false;
  }
  async function search(cloud = false, retain = false) {
    cancelSearch();
    const term = query.value.trim(),
      generation = auth.value.generation,
      expected = searchEpoch;
    if (!term || !auth.value.user) {
      searchRows.value = [];
      return;
    }
    searchMode.value = cloud ? "cloud" : "local";
    searchError.value = "";
    searching.value = !retain;
    if (!retain) searchRows.value = [];
    const request = crypto.randomUUID();
    searchRequest = request;
    try {
      const result = await ipc.search(
        generation,
        view.value,
        term,
        cloud,
        request,
        [...selectedTags.value],
      );
      if (expected === searchEpoch && generation === auth.value.generation)
        searchRows.value = result;
    } catch (e) {
      if (expected === searchEpoch)
        searchError.value = (e as CoreError)?.code ?? "default";
    } finally {
      if (expected === searchEpoch) {
        searching.value = false;
        searchRequest = undefined;
      }
    }
  }
  watch(query, () => {
    cancelSearch();
    searchRows.value = [];
    searchMode.value = "local";
    searchError.value = "";
    if (query.value.trim()) {
      searching.value = true;
      searchTimer = setTimeout(() => void search(), 160);
    }
  });
  watch(
    () => current.value?.status,
    (status, old) => {
      if (status === "success" && old && old !== "success" && selected.value)
        void select(selected.value);
    },
  );
  function fail(reason: unknown) {
    error.value = (reason as CoreError)?.code ?? "default";
  }
  async function bind() {
    const expected = ++epoch,
      generation = auth.value.generation;
    loading.value = true;
    error.value = "";
    if (watchId) {
      void ipc.unwatch(watchId);
      watchId = undefined;
    }
    if (!auth.value.user) {
      snapshot.value = null;
      sync.value = null;
      loading.value = false;
      return;
    }
    try {
      let revision = -1;
      const id = await ipc.watch(
        generation,
        view.value,
        (update) => {
          if (expected !== epoch || generation !== auth.value.generation)
            return;
          if (update.kind === "sync") {
            sync.value = update.value;
            return;
          }
          const value = update.value,
            changed = value.revision !== revision;
          revision = value.revision;
          sync.value = value.sync;
          snapshot.value = value;
          loading.value = false;
          if (
            changed &&
            query.value.trim() &&
            searchMode.value === "local" &&
            !searching.value
          )
            void search(false, true);
          if (
            selected.value &&
            !query.value.trim() &&
            !value.bookmarks.some((b) => b.id === selected.value)
          )
            void select(null);
        },
        [...selectedTags.value],
      );
      if (expected !== epoch) void ipc.unwatch(id);
      else watchId = id;
    } catch (e) {
      if (expected === epoch) {
        fail(e);
        loading.value = false;
      }
    }
  }
  async function initialize() {
    try {
      const [state, prefs, signals, info] = await Promise.all([
        ipc.auth(),
        ipc.preferences(),
        ipc.system(),
        ipc.build(),
      ]);
      build.value = info;
      preferences.value = prefs;
      system.value = signals;
      await setAuth(state);
    } catch (e) {
      fail(e);
      loading.value = false;
    }
  }
  async function setAuth(state: AuthState) {
    if (state.generation !== auth.value.generation) {
      await select(null);
      snapshot.value = null;
      sync.value = null;
      cancelSearch();
      query.value = "";
      selectedTags.value = [];
      searchRows.value = [];
    }
    auth.value = state;
    await bind();
  }
  async function navigate(next: string) {
    cancelSearch();
    view.value = next;
    if (next.startsWith("collection:")) selectedTags.value = [];
    query.value = "";
    await select(null);
    if (snapshot.value) snapshot.value = { ...snapshot.value, bookmarks: [] };
    await bind();
  }
  async function filterTags(ids: string[]) {
    cancelSearch();
    selectedTags.value = [...ids];
    searchMode.value = "local";
    searchRows.value = [];
    if (view.value.startsWith("collection:")) {
      view.value = "inbox";
      await select(null);
    }
    await bind();
    if (query.value.trim()) await search();
  }
  async function toggleTag(id: string) {
    await filterTags(
      selectedTags.value.includes(id)
        ? selectedTags.value.filter((v) => v !== id)
        : [...selectedTags.value, id],
    );
  }
  const releasing = new Set<(handle: string) => Promise<void>>();
  /** Registers work (such as a pending progress write) that must finish before a handle closes. */
  function beforeClose(flush: (handle: string) => Promise<void>) {
    releasing.add(flush);
    return () => releasing.delete(flush);
  }
  function release(value: ReaderDocument | null, generation: string) {
    if (!value) return;
    void Promise.allSettled([...releasing].map((flush) => flush(value.handle)))
      .then(() => ipc.close(generation, value.handle))
      .catch(() => {});
  }
  let loadingTimer: ReturnType<typeof setTimeout> | undefined;
  async function select(id: string | null) {
    const expected = ++readerEpoch,
      generation = auth.value.generation;
    clearTimeout(loadingTimer);
    selected.value = id;
    readerError.value = "";
    readerLoading.value = false;
    if (!auth.value.user) {
      release(document.value, generation);
      document.value = null;
      return;
    }
    void ipc.select(generation, id).catch(fail);
    if (!id || current.value?.status !== "success") {
      release(document.value, generation);
      document.value = null;
      return;
    }
    if (document.value?.bookmarkId === id) return;
    loadingTimer = setTimeout(() => {
      if (expected === readerEpoch) readerLoading.value = true;
    }, 150);
    try {
      const result = await ipc.open(generation, id);
      if (expected !== readerEpoch || generation !== auth.value.generation) {
        void ipc.close(generation, result.handle).catch(() => {});
        return;
      }
      release(document.value, generation);
      document.value = result;
    } catch (e) {
      if (expected === readerEpoch) {
        release(document.value, generation);
        document.value = null;
        readerError.value = (e as CoreError)?.code ?? "default";
      }
    } finally {
      if (expected === readerEpoch) {
        clearTimeout(loadingTimer);
        readerLoading.value = false;
      }
    }
  }
  async function mutate(bookmark: Bookmark, action: BookmarkAction) {
    try {
      await ipc.mutate(auth.value.generation, bookmark.id, action);
    } catch (e) {
      fail(e);
    }
  }
  async function add(url: string) {
    const generation = auth.value.generation;
    const id = await ipc.add(generation, url);
    if (generation === auth.value.generation) {
      selectedTags.value = [];
      await navigate("inbox");
      await select(id);
    }
  }
  async function savePreferences(value: Preferences) {
    preferences.value = value;
    await ipc.savePreferences({ ...value });
  }
  async function signOut(discard: boolean) {
    await ipc.signOut(auth.value.generation, discard);
    await setAuth({ user: null, pending: false, generation: "" });
  }
  function dispose() {
    epoch++;
    readerEpoch++;
    cancelSearch();
    if (watchId) void ipc.unwatch(watchId).catch(() => {});
  }
  return {
    auth,
    build,
    snapshot,
    sync,
    document,
    beforeClose,
    view,
    query,
    selectedTags,
    filterTags,
    toggleTag,
    selected,
    loading,
    readerLoading,
    error,
    readerError,
    preferences,
    system,
    rows,
    current,
    searching,
    searchMode,
    searchError,
    search,
    cancelSearch,
    fail,
    bind,
    initialize,
    setAuth,
    navigate,
    select,
    mutate,
    add,
    savePreferences,
    signOut,
    dispose,
  };
});
