import { defineStore } from "pinia";
import { ref, shallowRef, watch } from "vue";
import type {
  RssSubscription,
  RssSubscriptionsResponse,
  RssEntry,
  RssEntriesResponse,
  RssSaveResponse,
} from "@slax-reader/contracts";
import type { ReaderDocument, CoreError } from "../ipc/generated";
import { ipc } from "../ipc/client";
import { useLibrary } from "./library";
export const useRss = defineStore("rss", () => {
  const library = useLibrary();
  const feeds = ref<RssSubscription[]>([]),
    entries = ref<RssEntry[]>([]),
    selectedFeed = ref<string | null>(null);
  const doc = shallowRef<ReaderDocument | null>(null),
    entry = ref<RssEntry | null>(null);
  const loading = ref(false),
    readerLoading = ref(false),
    busy = ref(false),
    enabled = ref(false),
    ready = ref(false),
    error = ref(""),
    readerError = ref(""),
    adding = ref(false);
  const cursor = ref<string | null>(null),
    hasMore = ref(false);
  let epoch = 0,
    readerEpoch = 0;
  const pages = new Map<string, RssEntriesResponse>();
  function close(generation = library.auth.generation) {
    readerEpoch++;
    if (doc.value) void ipc.close(generation, doc.value.handle).catch(() => {});
    doc.value = null;
    entry.value = null;
    readerLoading.value = false;
  }
  watch(
    () => library.auth.generation,
    (_, old) => {
      epoch++;
      close(old);
      pages.clear();
      ready.value = false;
      enabled.value = false;
      entries.value = [];
      feeds.value = [];
      selectedFeed.value = null;
      adding.value = false;
      error.value = "";
      loading.value = false;
      busy.value = false;
    },
  );
  function show(page: RssEntriesResponse) {
    entries.value = page.items;
    cursor.value = page.next_cursor ?? null;
    hasMore.value = page.has_more;
  }
  async function load() {
    const expected = ++epoch,
      generation = library.auth.generation,
      feed = selectedFeed.value;
    loading.value = true;
    error.value = "";
    try {
      const labs = await ipc.product<{
        features: { key: string; enabled: boolean }[];
      }>(generation, "labs");
      if (expected !== epoch) return;
      enabled.value = labs.features.some((v) => v.key === "rss" && v.enabled);
      if (!enabled.value) {
        ready.value = true;
        return;
      }
      const [subscriptions, page] = await Promise.all([
        ipc.product<RssSubscriptionsResponse>(generation, "rss_list"),
        ipc.product<RssEntriesResponse>(
          generation,
          "rss_entries",
          feed ? { subscription_id: feed } : {},
        ),
      ]);
      if (expected !== epoch || generation !== library.auth.generation) return;
      feeds.value = subscriptions.items;
      pages.set(feed ?? "", page);
      show(page);
      ready.value = true;
    } catch (e) {
      if (expected === epoch) error.value = (e as CoreError)?.code ?? "default";
    } finally {
      if (expected === epoch) loading.value = false;
    }
  }
  async function chooseFeed(id: string | null) {
    if (selectedFeed.value === id && ready.value) return;
    selectedFeed.value = id;
    close();
    const cached = pages.get(id ?? "");
    if (cached) show(cached);
    else {
      entries.value = [];
      cursor.value = null;
      hasMore.value = false;
    }
    await load();
  }
  async function choose(value: RssEntry) {
    close();
    const expected = readerEpoch,
      generation = library.auth.generation;
    entry.value = value;
    readerError.value = "";
    const delay = setTimeout(() => {
      if (expected === readerEpoch) readerLoading.value = true;
    }, 150);
    try {
      const result = await ipc.rssOpen(generation, value.id);
      if (expected !== readerEpoch || generation !== library.auth.generation) {
        void ipc.close(generation, result.handle).catch(() => {});
        return;
      }
      doc.value = result;
    } catch (e) {
      if (expected === readerEpoch)
        readerError.value = (e as CoreError)?.code ?? "default";
    } finally {
      clearTimeout(delay);
      if (expected === readerEpoch) readerLoading.value = false;
    }
  }
  async function action(operation: string, input: Record<string, unknown>) {
    if (busy.value) return;
    const generation = library.auth.generation;
    busy.value = true;
    try {
      await ipc.product(generation, operation, input);
      if (generation === library.auth.generation) await load();
    } catch (e) {
      if (generation === library.auth.generation) library.fail(e);
    } finally {
      if (generation === library.auth.generation) busy.value = false;
    }
  }
  async function follow(url: string) {
    await action("rss_add", { url, remark: null });
    adding.value = false;
  }
  async function unfollow(id: string) {
    if (selectedFeed.value === id) {
      selectedFeed.value = null;
      close();
    }
    pages.delete(id);
    await action("rss_delete", { id });
  }
  async function save() {
    if (!entry.value || busy.value) return;
    const value = entry.value,
      generation = library.auth.generation;
    busy.value = true;
    try {
      const result = await ipc.product<RssSaveResponse>(
        generation,
        "rss_save",
        { id: value.id },
      );
      if (generation !== library.auth.generation) return;
      value.bookmark_user_uuid = result.bookmark_user_uuid;
      await library.bind();
    } catch (e) {
      if (generation === library.auth.generation) library.fail(e);
    } finally {
      if (generation === library.auth.generation) busy.value = false;
    }
  }
  async function more() {
    if (!hasMore.value || busy.value || loading.value) return;
    const expected = epoch,
      generation = library.auth.generation;
    busy.value = true;
    try {
      const page = await ipc.product<RssEntriesResponse>(
        generation,
        "rss_entries",
        {
          ...(selectedFeed.value
            ? { subscription_id: selectedFeed.value }
            : {}),
          ...(cursor.value ? { cursor: cursor.value } : {}),
          fetch_history: true,
        },
      );
      if (expected !== epoch || generation !== library.auth.generation) return;
      const items = [
        ...entries.value,
        ...page.items.filter((v) => !entries.value.some((e) => e.id === v.id)),
      ];
      const combined = { ...page, items };
      pages.set(selectedFeed.value ?? "", combined);
      show(combined);
    } catch (e) {
      if (expected === epoch) library.fail(e);
    } finally {
      if (generation === library.auth.generation) busy.value = false;
    }
  }
  return {
    feeds,
    entries,
    selectedFeed,
    doc,
    entry,
    loading,
    readerLoading,
    busy,
    enabled,
    ready,
    error,
    readerError,
    adding,
    hasMore,
    load,
    chooseFeed,
    choose,
    close,
    follow,
    unfollow,
    save,
    more,
    enable: () => action("rss_enable", { enabled: true }),
    refresh: () =>
      selectedFeed.value
        ? action("rss_refresh", { id: selectedFeed.value })
        : load(),
  };
});
